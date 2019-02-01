require('dotenv').config();

const {
	MessengerBot, FileSessionStore, withTyping, MessengerHandler,
} = require('bottender');
const { createServer } = require('bottender/restify');
const { MessengerClient } = require('messaging-api-messenger');
//const dialogFlow = require('apiai-promise');

const config = require('./bottender.config.js').messenger;
const sendModule = require('./send.js')
const opt = require('./utils/options');
const { Sentry } = require('./utils/helper');
const broadcast = require('./broadcast.js');
const PouchDB = require('pouchdb')
const db = new PouchDB('userBase');
const request = require('request')
const jwt = require('jwt-simple');
const nutrinetApi = process.env.NUTRINET_API
const nutrinetSite = process.env.NUTRINET_SITE
const nutrinetApiSecret = process.env.NUTRINET_API_SECRET

let pageInfo = []

getPageInfo()

function getPageInfo() {
	let listAccessTokensUrl = nutrinetApi + '/maintenance/chatbot-list-access-tokens?secret=' + nutrinetApiSecret
	request(listAccessTokensUrl, function (error, response, body) {
		let data = JSON.parse(body);
		if (!error && !data.error) {
			data.pages.forEach(element => {
				if (element.is_valid) {
					let index = pageInfo.findIndex(ele => {
						return ele.page_id === element.pageId
					})
					if (index !== -1) {
						pageInfo[index].access_token = element.access_token;
						pageInfo[index].private_jwt_token = element.private_jwt_token;
						pageInfo[index].client =  MessengerClient.connect(element.access_token);
						broadcast.start(pageInfo[index].client, db)
					}
					else {
						pageInfo.push({
							page_id: element.page_id,
							access_token: element.access_token,
							private_jwt_token: element.private_jwt_token,
							client: MessengerClient.connect(element.access_token)
						})
						broadcast.start(pageInfo[pageInfo.length - 1].client, db)
					}
				}
			})
		}
		else {
			let err = error || data.error
			throw 'Error with the API, cannot get page informations, please fix it and restart.\nError: ' + err;
		}
	})
}

const mapPageToAccessToken = async (pageId) => {
	let filtered = pageInfo.filter(element => {
		return element.page_id === pageId
	})
	return filtered[0].access_token;
};

const bot = new MessengerBot({
	mapPageToAccessToken,
	appSecret: config.appSecret,
	sessionStore: new FileSessionStore(),
});

bot.setInitialState({});

bot.use(withTyping({ delay: 1000 * 2 }));

async function waitTypingEffect(context) {
	await context.typingOn();
	setTimeout(async () => {
		await context.typingOff();
	}, 2500);
}

async function getBlockFromPayload(context) {
	let payload = context.event.message.quick_reply.payload
	if (context.state.dialog !== 'Quero participar') {
		await context.setState({ dialog: payload });
	}
	return;
}

const handler = new MessengerHandler()
	.onEvent(async (context) => { // eslint-disable-line
		try {
			if (!context.state.dialog || context.state.dialog === '' || (context.event.postback && context.event.postback.payload === 'greetings')) { // because of the message that comes from the comment private-reply
				await context.resetState();
				await context.setState({ dialog: 'greetings' });
			}
			await context.typingOn();
			if (context.event.isQuickReply && context.state.dialog !== 'recipientData') {
				await getBlockFromPayload(context)
			}
			let current_user = {}
			await db.get(context.session.user.id).then(async function (doc) {
			  // user already exists
				doc.name = context.session.user.first_name;
				doc.last_name = context.session.user.last_name;
				doc.gender = context.session.user.gender;
				doc.pageId = context.event.pageId;
		    doc.session = JSON.stringify(context.state);
				await db.put(doc, function callback(err, result) {
					if (!err) {
						console.log('Successfully updated the user ' + doc._id);
						current_user = doc;
						current_user._rev = result.rev
					}
					else {
						console.log(err);
					}
				});
			}).catch(async function (err) {
				let user = {
			    _id: context.session.user.id,
					pageId: context.event.pageId,
					name: context.session.user.first_name,
					last_name: context.session.user.last_name,
					gender: context.session.user.gender,
			    session: JSON.stringify(context.state)
	  		};
				await db.put(user, function callback(err, result) {
			    if (!err) {
			      console.log('Successfully posted user with id ' + context.session.user.id);
						current_user = user;
			    }
					else {
						console.log(err);
					}
			  });
			});

		// Tratando dados adicionais do recipient
		if (context.state.dialog === 'recipientData' && context.state.recipientData) {
			if (context.event.isQuickReply) {
				await context.setState({ email: context.event.message.quick_reply.payload });
			} else if (context.event.isText) {
				await context.setState({ email: context.event.message.text });
			} if (context.event.isPostback) {
				await context.setState({ email: context.event.postback.payload });
			}
		}
		if (context.state.dialog === 'recipientData' && context.state.recipientData) {
			if (context.state.recipientData === 'email') {
				await context.setState({dialog: 'waiting', time: Date.now()})
				current_user.email = context.state.email;
			  current_user.session = JSON.stringify(context.state);
				db.put(current_user, function callback(err, result) {
			    if (!err) {
			      console.log('Successfully updated ' + current_user._id + ' with email ' + current_user.email);
			    }
					else {
						console.log(err);
					}
			  });
				await context.sendText(`Obrigada! 😊`);
				await waitTypingEffect(context);
				await context.sendText(`Que tal ir para o site da pesquisa e fazer parte desse impacto na sociedade?`);
				let payload = {
					name: current_user.name + ' ' + current_user.last_name,
					page_id: current_user.pageId,
					fb_id: current_user._id,
					gender: current_user.gender,
					email: context.state.email
				};
				let filtered = pageInfo.filter(element => {
					return element.page_id === current_user.pageId
				})
				let secret = filtered[0].private_jwt_token;
				let token = jwt.encode(payload, secret)
				let card = [{
					title: 'NutriNet Brasil',
					image_url: nutrinetApi + '/static-html-templates/header.jpg',
					subtitle: 'Ajude a promover a saúde e a nutrição de milhões de brasileiros',
					default_action: {
						type: 'web_url',
						url: nutrinetSite + '?chatbot_token=' + token,
						messenger_extensions: false
					},
					buttons: [{
						type: "web_url",
						url: nutrinetSite + '?chatbot_token=' + token,
						title: 'NutriNet Brasil'
					}]
				}]
				await context.sendGenericTemplate(card)
				setTimeout(async () => {
					await context.sendText('Sabe o que seria tão legal quanto participar dessa pesquisa? Compartilhar com o maior número de pessoas possível!');
					await waitTypingEffect(context);
					await context.sendText('[apresentar cards de compartilhar]');
				}, 3600000);
			}
		}

		await context.typingOff();
		switch (context.state.dialog) {
			case 'greetings': // primeiro
				await context.sendText(`Olá, ${context.session.user.first_name}. Que bom te ver por aqui!`);
				await waitTypingEffect(context);
				await context.sendText(`Sou a Ana, assistente digital da Nutrinet Brasil: uma pesquisa científica inédita da USP que busca saber como a alimentação atual dos brasileiros influencia a sua saúde.`);
				await context.sendText(`Você se interessa pelo tema “alimentação e saúde”?`, { quick_replies: opt.GostaAlimentacaoESaude });
				break;
			case 'Alimentação - Conta mais':
				await context.sendText(`Essa pesquisa foi feita para você! Tenho certeza de que você vai gostar de participar 😃`);
				await waitTypingEffect(context);
				await context.sendText(`Esta é uma pesquisa da USP que contará com voluntários como você. Sua participação fará a diferença! Você e toda a sociedade irão se beneficiar com esse estudo.`);
				await waitTypingEffect(context);
				await context.sendText(`Vou te explicar como funciona!`, { quick_replies: opt.AlimentacaoContaMais });
				break;
			case 'Alimentação - Não':
				await context.sendText(`Poxa! Tudo bem, você pode não se interessar pelo tema “alimentação”, mas sei que, diferentemente de mim, que sou um robô, você se alimenta, certo? E, como para todo mundo, saúde é algo que deve te interessar!`);
				await waitTypingEffect(context);
				await context.sendText(`Vou te mostrar como funciona a pesquisa. Acredito que vai te interessar. Que tal?`, { quick_replies: opt.AlimentacaoNao });
				break;
			case 'Como funciona a pesquisa':
				await context.sendText(`No início você responderá a questionários rápidos sobre sua alimentação, saúde, condições de vida e outras informações que contribuem para seu estado de saúde.\n
Após alguns meses, solicitaremos informações mais detalhadas sobre como você se alimenta. Periodicamente, a cada três ou seis meses, pediremos que atualize as informações solicitadas inicialmente.\n
São questionários tranquilos de responder. :)`, { quick_replies: opt.ComoFuncionaAPesquisa });
				break;
			case 'Como funciona2':
				await context.sendText(`Para resumir: você gastará pouco tempo para responder a breves questionários, que serão repetidos após certo período. Com essa participação, você irá colaborar para melhorar a saúde de muitas pessoas!`);
				await waitTypingEffect(context);
				await context.sendText(`A pesquisa pode durar vários anos. Mas não se assuste, a pesquisa busca entender a alimentação dos brasileiros, ou seja, não haverá julgamentos e muito menos divulgação dos seus dados. 😉`);
				await waitTypingEffect(context);
				await context.sendText(`E olha que legal: você receberá um certificado da USP! E quanto mais amigos indicar melhor será. 🎉😍`, { quick_replies: opt.ComoFunciona2 });
				break;
			case 'Quero participar':
				await context.sendText(`Que bacana! 😉`);
				await waitTypingEffect(context);
				await context.sendText(`Sua participação nos ajudará a saber como a alimentação atual dos brasileiros influencia a sua saúde e identificar quais mudanças nessa alimentação trariam mais benefícios.`);
				await waitTypingEffect(context);
				try {
					await context.sendText('Agora me conta. Qual seu e-mail?', { quick_replies: [{ content_type: 'user_email' }] });
				} catch(err) {
					await context.sendText('Agora me conta. Qual seu e-mail?');
				}
				finally {
					await context.setState({ dialog: 'recipientData', recipientData: 'email' });
				}
				break;
			case 'Ainda tenho dúvidas':
				await context.sendText(`Tudo bem 😉`);
				await waitTypingEffect(context);
				await context.sendText(`O professor da USP Carlos Monteiro fez um vídeo sobre a pesquisa para você, olha só:`);
				await waitTypingEffect(context);
				await context.sendText(`[link video]`, { quick_replies: opt.AindaTenhoDuvidas });
				break;
			case 'lembrete':
				await context.sendText(`(lembrete: mensagem exemplo de lembrete de pesquisa)\n\nOlá, ${context.session.user.first_name}.`);
				await waitTypingEffect(context);
				await context.sendText(`Conforme o prometido, estou aqui para lembrar que você tem um questionário novo para responder. Vamos lá?`);
				await waitTypingEffect(context);
				await context.sendText(`[card link]`);
				await waitTypingEffect(context);
				await context.sendText(`Não se esqueça de compartilhar com seus amigos!`);
				await waitTypingEffect(context);
				await context.sendText(`[apresentar cards de share]`, { quick_replies: opt.lembrete });
				break;
			case 'Não tenho interesse':
				await context.sendText(`Tudo bem! 😉`);
				await waitTypingEffect(context);
				await context.sendText(`Você pode compartilhar com seus amigos que possam se interessar pela pesquisa inédita da USP?`);
				await waitTypingEffect(context);
				await context.sendText(`[apresentar cards de compartilhar]`);
				await waitTypingEffect(context);
				await context.sendText(`Você pode voltar aqui quando quiser para conversar comigo 😉`);
				await waitTypingEffect(context);
				await context.sendText(`Ainda tenho esperanças de ver você e seus amigos na pesquisa 😊 Abs!`, { quick_replies: [{ title: 'Voltar para o início', content_type: 'text', payload: 'greetings' }] });
				break;
			case 'Ver exp curiosidade':
				await context.sendText(`(curiosidade: mensagem exemplo de curiosidade da pesquisa / feedback)\n\nOlá, ${context.session.user.first_name}! Dei uma olhada na pesquisa até aqui e quero compartilhar com você algumas curiosidades. Olha só:`);
				await waitTypingEffect(context);
				await context.sendText(`[link do artigo ou mensagem sobre o fato e/ou imagem]`);
				await waitTypingEffect(context);
				await context.sendText(`Não esqueça de compartilhar a pesquisa com seus amigos!`);
				await waitTypingEffect(context);
				await context.sendText(`[apresentar cards de share]`);
				break;
			case 'waiting':
				let session = JSON.parse(current_user.session)
				let diff = hoursBetween(new Date(session.time), new Date())
				if (diff > 50) {
					await context.setState({ dialog: 'Finish' });
					current_user.notification_time = context.event.message.text;
				  current_user.session = JSON.stringify(context.state);
					db.put(current_user, function callback(err, result) {
				    if (!err) {
				      console.log('Successfully updated ' + current_user._id + ' with email ' + current_user.email);
				    }
				  });
					let updateUserUrl = `${nutrinetApi}/maintenance/chatbot-user-preferences?fb_id=${current_user._id}&page_id=${current_user.pageId}&preferences=%7B%22notification_time%22%3A%22${context.event.message.text}%22%7D&secret=${nutrinetApiSecret}`;
					request.put(updateUserUrl, function (error, response, body) {
						let data = JSON.parse(body);
					})
					await context.sendText(`Legal! Assim eu mando o próximo questionário no horário certo para você. 😉`);
					await waitTypingEffect(context);
					await context.sendText(`E não se esqueça de compartilhar com seus amigos!`);
					await waitTypingEffect(context);
					await context.sendText(`[apresentar cards de compartilhar]`);
					break;
				}
				else {
					break;
				}
		} // end switch de diálogo
	} catch (err) {
		const date = new Date();
		console.log('\n');
		console.log(`Parece que aconteceu um erro as ${date.toLocaleTimeString('pt-BR')} de ${date.getDate()}/${date.getMonth() + 1} =>`);
		console.log(err);
		await Sentry.configureScope(async (scope) => {
			if (context.session.user && context.session.user.first_name && context.session.user.last_name) {
				scope.setUser({ username: `${context.session.user.first_name} ${context.session.user.last_name}` });
				console.log(`Usuário => ${context.session.user.first_name} ${context.session.user.last_name}`);
			} else {
				scope.setUser({ username: 'no_user' });
				console.log('Usuário => Não conseguimos descobrir o nome do cidadão');
			}
			if (context.state && context.state.politicianData && context.state.politicianData.name
				&& context.state.politicianData.office && context.state.politicianData.office.name) {
				scope.setExtra('admin', `${context.state.politicianData.office.name} ${context.state.politicianData.name}`);
				console.log(`Administrador => ${context.state.politicianData.office.name} ${context.state.politicianData.name}`);
			} else {
				scope.setExtra('admin', 'no_admin');
				console.log('Administrador => Não conseguimos descobrir o nome do político');
			}

			scope.setExtra('state', context.state);
			throw err;
		});
	} // catch
		// }); // sentry context
		function hoursBetween(date1, date2) {
	    //Get 1 hour in milliseconds
	    var one_hour = 1000*60*60;

	    // Convert both dates to milliseconds
	    var date1_ms = date1.getTime();
	    var date2_ms = date2.getTime();

	    // Calculate the difference in milliseconds
	    var difference_ms = date2_ms - date1_ms;

	    // Convert back to days and return
	    return (difference_ms/one_hour);
	  }
}); // function handler


bot.onEvent(handler);

const server = createServer(bot, { verifyToken: config.verifyToken });

server.post('/send', function (req, res, next) {
	if (!req.query || !req.query.secret || req.query.secret != nutrinetApiSecret) {
		res.status(401);
		res.send({error: "a correct secret is required in the querystring"});
		return next();
	}
	res.contentType = 'json';
	let page_id = req.body.page_id;
	if (Number.isInteger(page_id)) {
		page_id = '' + page_id;
	}
	let fb_ids = req.body.fb_ids;
	let message = req.body.message;
	if (typeof page_id !== "string" || !Array.isArray(fb_ids) || (typeof message !== "string" && typeof message !== "number"))
	{
		res.status(400);
		res.send({error: "malformated"});
		return next();
	}
	let index = pageInfo.findIndex(ele => {
		return ele.page_id === page_id
	})
	if (index === -1) {
		res.status(400);
		res.send({error: "page_id does not exists"});
		return next();
	}
  sendModule.send(pageInfo[index].client, fb_ids, message, function(result, errCode) {
		if (errCode) {
			res.status(errCode);
		}
		res.send(result);
		return next();
	});
});

server.get('/update-token', function (req, res, next) {
  getPageInfo();
	res.send(200);
	return next();
});

server.get('/user-info', function (req, res, next) {
	if (!req.query || !req.query.secret || req.query.secret != nutrinetApiSecret) {
		res.status(401);
		res.send({error: "a correct secret is required in the querystring"});
		return next();
	}
	if (req.query.id) {
		db.get(req.query.id).then(function (doc) {
			doc.facebook_id = doc._id;
			delete(doc._rev);
			delete(doc._id);
			res.send(doc);
		}).catch(function (err) {
			res.send(404);
		});
	}
	else {
		db.allDocs({include_docs: true, descending: true}, function(err, data) {
			let result = [];
			data.rows.forEach(element => {
				element.doc.facebook_id = element.doc._id;
				delete(element.doc._rev);
				delete(element.doc._id);
				result.push(element.doc);
			})
			res.send(result);
		})
	}
	return next();
});

server.listen(process.env.API_PORT, () => {
	console.log(`Server is running on ${process.env.API_PORT} port...`);
});
