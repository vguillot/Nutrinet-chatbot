/* eslint no-param-reassign: 0 */ // --> OFF

require('dotenv').config();

const {	MessengerBot, FileSessionStore, MessengerHandler } = require('bottender');
const { createServer } = require('bottender/restify');
const { MessengerClient } = require('messaging-api-messenger');
// const dialogFlow = require('apiai-promise');
const request = require('request');
const PouchDB = require('pouchdb');

const config = require('./bottender.config.js').messenger;
const sendModule = require('./send.js');
const opt = require('./utils/options');
const help = require('./utils/helper');
const { Sentry } = require('./utils/helper');
const broadcast = require('./broadcast.js');
const checkInput = require('./utils/checkInput');

const db = new PouchDB('userBase');

const nutrinetApi = process.env.NUTRINET_API;
const nutrinetApiSecret = process.env.NUTRINET_API_SECRET;

const horarioRegex = new RegExp(/^([\d{1,2}])(?:\s*(?:horas?|h)?)?(\se\s)?(?:(\d{1,2})(?:m|minutos?)?)?$/);

const pageInfo = [];

const mapPageToAccessToken = async (pageId) => {
	const filtered = pageInfo.filter(element => element.page_id === pageId);

	// console.log(process.env.ACCESS_TOKEN);
	// console.log(filtered[0].access_token); // it's not updated yet
	// console.log(pageInfo);

	if (filtered && filtered[0] && filtered[0].access_token) {
		return filtered[0].access_token;
	}
	return process.env.ACCESS_TOKEN;
};

const bot = new MessengerBot({
	mapPageToAccessToken,
	appSecret: config.appSecret,
	sessionStore: new FileSessionStore(),
});

bot.setInitialState({});

// bot.use(withTyping({ delay: 1000 * 0.1 }));

function getPageInfo() {
	const listAccessTokensUrl = `${nutrinetApi}/maintenance/chatbot-list-access-tokens?secret=${nutrinetApiSecret}`;
	request(listAccessTokensUrl, (error, response, body) => {
		const data = JSON.parse(body);
		if (!error && !data.error) {
			data.pages.forEach((element) => {
				if (element.is_valid) {
					const index = pageInfo.findIndex(ele => ele.page_id === element.pageId);
					if (index !== -1) {
						pageInfo[index].access_token = element.access_token;
						pageInfo[index].private_jwt_token = element.private_jwt_token;
						pageInfo[index].client = MessengerClient.connect(element.access_token);
						broadcast.start(pageInfo[index].client, db);
					} else {
						pageInfo.push({
							page_id: element.page_id,
							access_token: element.access_token,
							private_jwt_token: element.private_jwt_token,
							client: MessengerClient.connect(element.access_token),
						});
						broadcast.start(pageInfo[pageInfo.length - 1].client, db);
					}
				}
			});
		} else {
			const err = error || data.error;
			throw new Error(`Error with the API, cannot get page informations, please fix it and restart.\nError Message: ${err}`);
		}
	});
}

getPageInfo();

// async function waitTypingEffect(context) { // eslint-disable-line no-unused-vars
// await context.typingOn();
// setTimeout(async () => {
// 	await context.typingOff();
// }, 2500);
// }

const handler = new MessengerHandler()
	.onEvent(async (context) => {
		try {
			let currentUser = {};
			if (!context.state.dialog || context.state.dialog === '' || (context.event.postback && context.event.postback.payload === 'greetings')) { // because of the message that comes from the comment private-reply
				// await context.resetState();
				await context.setState({ listenToHorario: false, listenEmail: false });
				await context.setState({ dialog: 'greetings' });
				// await context.setState({ dialog: 'Quero participar' });
			}

			await db.get(context.session.user.id).then(async (doc) => {
				// user already exists
				doc.name = context.session.user.first_name;
				doc.last_name = context.session.user.last_name;
				doc.gender = context.session.user.gender;
				doc.pageId = context.event.pageId;
				doc.session = JSON.stringify(context.state);
				await db.put(doc, (err, result) => {
					if (!err) {
						console.log(`Successfully updated the user ${doc._id}`);
						currentUser = doc;
						currentUser._rev = result.rev;
					} else { console.log(err); }
				});
			}).catch(async (err) => { // eslint-disable-line no-unused-vars
				const user = { // user doesnt exist
					_id: context.session.user.id,
					pageId: context.event.pageId,
					name: context.session.user.first_name,
					last_name: context.session.user.last_name,
					gender: context.session.user.gender,
					session: JSON.stringify(context.state),
				};
				await db.put(user, (err2, result) => { // eslint-disable-line no-unused-vars
					if (!err2) {
						console.log(`Successfully created user with id ${context.session.user.id}`);
						currentUser = user;
					} else { console.log(err2); }
				});
			});

			if (context.event.isQuickReply && context.state.dialog !== 'recipientData') {
				const { payload } = context.event.message.quick_reply;
				if (context.state.listenEmail === true) {
					await context.setState({ email: context.event.message.quick_reply.payload });
					await checkInput.saveEmail(context, currentUser, db, pageInfo);
				} else {
					await context.setState({ dialog: payload });
				} // end quickreply
			} else if (context.event.isText && context.state.dialog !== 'recipientData') { // handles text input
				await context.setState({ whatWasTyped: context.event.message.text });
				if (context.state.listenEmail === true) { // user about to enter e-mail
					await context.setState({ email: context.state.whatWasTyped });
					await checkInput.saveEmail(context, currentUser, db, pageInfo);
				} else if (context.state.listenToHorario === true) { // user about to preferred horario
					if (horarioRegex.test(context.state.whatWasTyped)) { // check regex
						await context.sendText('Tudo bem, essa entrada é válida');
						await context.setState({ dialog: 'validHorario' });
					} else {
						await context.sendText('Inválido. Tente novamente');
					}
				} else { // not on listenToHorario
					await context.sendText('Não entendi o que você digitou.');
				}
			} // end text


			switch (context.state.dialog) {
			case 'greetings': // primeiro
				await context.sendText(`Olá, ${context.session.user.first_name}. Que bom te ver por aqui!`);
				await context.sendText('Sou a Ana, assistente digital da NutriNet Brasil: uma pesquisa científica inédita da USP que busca saber como a alimentação atual dos brasileiros influencia a sua saúde.');
				await context.sendText('Você se interessa pelo tema “alimentação e saúde”?', { quick_replies: opt.GostaAlimentacaoESaude });
				break;
			case 'Alimentação - Conta mais':
				await context.sendText('Essa pesquisa foi feita para você! Tenho certeza de que você vai gostar de participar 😃');
				await context.sendText('Esta é uma pesquisa da USP que contará com voluntários como você. Sua participação fará a diferença! Você e toda a sociedade irão se beneficiar com esse estudo.');
				await context.sendText('Vou te explicar como funciona!', { quick_replies: opt.AlimentacaoContaMais });
				break;
			case 'Alimentação - Não':
				await context.sendText('Poxa! Tudo bem, você pode não se interessar pelo tema “alimentação”, mas sei que, diferentemente de mim, que sou um robô, você se alimenta, certo? E, como para todo mundo, saúde é algo que deve te interessar!');
				await context.sendText('Vou te mostrar como funciona a pesquisa. Acredito que vai te interessar. Que tal?', { quick_replies: opt.AlimentacaoNao });
				break;
			case 'Como funciona a pesquisa':
				await context.sendText(`No início você responderá a questionários rápidos sobre sua alimentação, saúde, condições de vida e outras informações que contribuem para seu estado de saúde.\n
Após alguns meses, solicitaremos informações mais detalhadas sobre como você se alimenta. Periodicamente, a cada três ou seis meses, pediremos que atualize as informações solicitadas inicialmente.\n
São questionários tranquilos de responder. :)`, { quick_replies: opt.ComoFuncionaAPesquisa });
				break;
			case 'Como funciona2':
				await context.sendText('Para resumir: você gastará pouco tempo para responder a breves questionários, que serão repetidos após certo período. Com essa participação, você irá colaborar para melhorar a saúde de muitas pessoas!');
				await context.sendText('A pesquisa pode durar vários anos. Mas não se assuste, a pesquisa busca entender a alimentação dos brasileiros, ou seja, não haverá julgamentos e muito menos divulgação dos seus dados. 😉');
				await context.sendText('E olha que legal: você receberá um certificado da USP! E quanto mais amigos indicar melhor será. 🎉😍', { quick_replies: opt.ComoFunciona2 });
				break;
			case 'Quero participar':
				await context.sendText('Que bacana! 😉');
				await context.sendText('Sua participação nos ajudará a saber como a alimentação atual dos brasileiros influencia a sua saúde e identificar quais mudanças nessa alimentação trariam mais benefícios.');
				try {
					await context.sendText('Agora me conta. Qual seu e-mail?', { quick_replies: [{ content_type: 'user_email' }] });
				} catch (err) {
					await context.sendText('Agora me conta. Qual seu e-mail?');
				} finally {
					await context.setState({ listenEmail: true });
				}
				break;
			case 'Ainda tenho dúvidas':
				await context.sendText('Tudo bem 😉');
				await context.sendText('O professor da USP Carlos Monteiro fez um vídeo sobre a pesquisa para você, olha só:');
				await context.sendText('[link video]', { quick_replies: opt.AindaTenhoDuvidas });
				break;
			case 'lembrete':
				await context.sendText(`(lembrete: mensagem exemplo de lembrete de pesquisa)\n\nOlá, ${context.session.user.first_name}.`);
				await context.sendText('Conforme o prometido, estou aqui para lembrar que você tem um questionário novo para responder. Vamos lá?');
				await context.sendText('[card link]');
				await context.sendText('Não se esqueça de compartilhar com seus amigos!');
				await context.sendText('[apresentar cards de share]', { quick_replies: opt.lembrete });
				break;
			case 'Não tenho interesse':
				await context.sendText('Tudo bem! 😉');
				await context.sendText('Você pode compartilhar com seus amigos que possam se interessar pela pesquisa inédita da USP?');
				await context.sendText('[apresentar cards de compartilhar]');
				await context.sendText('Você pode voltar aqui quando quiser para conversar comigo 😉');
				await context.sendText('Ainda tenho esperanças de ver você e seus amigos na pesquisa 😊 Abs!', { quick_replies: [{ title: 'Voltar para o início', content_type: 'text', payload: 'greetings' }] });
				break;
			case 'Ver exp curiosidade':
				await context.sendText(`(curiosidade: mensagem exemplo de curiosidade da pesquisa / feedback)\n\nOlá, ${context.session.user.first_name}! Dei uma olhada na pesquisa até aqui e quero compartilhar com você algumas curiosidades. Olha só:`);
				await context.sendText('[link do artigo ou mensagem sobre o fato e/ou imagem]');
				await context.sendText('Não esqueça de compartilhar a pesquisa com seus amigos!');
				await context.sendText('[apresentar cards de share]');
				break;
			case 'waiting':
				const session = JSON.parse(currentUser.session);
				session.time = 30;
				const diff = await help.hoursBetween(new Date(session.time), new Date());
				if (diff > 50) {
					await context.setState({ dialog: 'Finish' });
					currentUser.notification_time = context.event.message.text;
					currentUser.session = JSON.stringify(context.state);
					db.put(currentUser, (err, result) => { // eslint-disable-line no-unused-vars
						if (!err) {
							console.log(`Successfully updated ${currentUser._id} with email ${currentUser.email}`);
						}
					});
					const updateUserUrl = `${nutrinetApi}/maintenance/chatbot-user-preferences?fb_id=${currentUser._id}&page_id=${currentUser.pageId}&preferences=%7B%22notification_time%22%3A%22${context.event.message.text}%22%7D&secret=${nutrinetApiSecret}`;
					request.put(updateUserUrl, (error, response, body) => {
						const data = JSON.parse(body);
						console.log('Data', data);
					});
					await context.sendText('Legal! Assim eu mando o próximo questionário no horário certo para você. 😉');
					await context.sendText('E não se esqueça de compartilhar com seus amigos!');
					await context.sendText('[apresentar cards de compartilhar]');
					break;
				} else {
					await context.sendText('Ops, esse formato não é válido');
				}
				break;
			case 'perguntar horario':
				await context.setState({ listenToHorario: true });
				await context.sendText('Em qual período você está disponível? Por exemplo, 2 e 15.');
				break;
			case 'validHorario':
				await help.sendPesquisaCard(context, currentUser, pageInfo);
				const updateUserUrl = `${nutrinetApi}/maintenance/chatbot-user-preferences?fb_id=${currentUser._id}&page_id=${currentUser.pageId}&preferences=%7B%22notification_time%22%3A%22${context.state.whatWasTyped}%22%7D&secret=${nutrinetApiSecret}`;
				request.put(updateUserUrl, (error, response, body) => {
					const data = JSON.parse(body);
					console.log('Data', data);
				});
				// setTimeout(async () => {
				// 	await context.sendText('Sabe o que seria tão legal quanto participar dessa pesquisa? Compartilhar com o maior número de pessoas possível!');
				// 	await context.sendText('[apresentar cards de compartilhar]');
				// }, 3600000);
				break;
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
	}); // function handler


bot.onEvent(handler);

const server = createServer(bot, { verifyToken: config.verifyToken });

server.post('/send', (req, res, next) => {
	if (!req.query || !req.query.secret || req.query.secret !== nutrinetApiSecret) {
		res.status(401);
		res.send({ error: 'a correct secret is required in the querystring' });
		return next();
	}
	res.contentType = 'json';
	let { pageId } = req.body;
	if (Number.isInteger(pageId)) {
		pageId = `${pageId}`;
	}
	const { fbIds } = req.body;
	const { message } = req.body;
	if (typeof pageId !== 'string' || !Array.isArray(fbIds) || (typeof message !== 'string' && typeof message !== 'number')) {
		res.status(400);
		res.send({ error: 'malformated' });
		return next();
	}
	const index = pageInfo.findIndex(ele => ele.page_id === pageId);
	if (index === -1) {
		res.status(400);
		res.send({ error: 'page_id does not exists' });
		return next();
	}
	sendModule.send(pageInfo[index].client, fbIds, message, (result, errCode) => {
		if (errCode) {
			res.status(errCode);
		}
		res.send(result);
		return next();
	});
	return next();
});

server.get('/update-token', (req, res, next) => {
	getPageInfo();
	res.send(200);
	return next();
});

server.get('/user-info', (req, res, next) => {
	if (!req.query || !req.query.secret || req.query.secret !== nutrinetApiSecret) {
		res.status(401);
		res.send({ error: 'a correct secret is required in the querystring' });
		return next();
	}
	if (req.query.id) {
		db.get(req.query.id).then((doc) => {
			doc.facebook_id = doc._id;
			delete (doc._rev);
			delete (doc._id);
			res.send(doc);
		}).catch((err) => { // eslint-disable-line no-unused-vars
			res.send(404);
		});
	} else {
		db.allDocs({ include_docs: true, descending: true }, (err, data) => {
			const result = [];
			data.rows.forEach((element) => {
				element.doc.facebook_id = element.doc._id;
				delete (element.doc._rev);
				delete (element.doc._id);
				result.push(element.doc);
			});
			res.send(result);
		});
	}
	return next();
});

server.listen(process.env.API_PORT, () => {
	console.log(`Server is running on ${process.env.API_PORT} port...`);
});
