/* eslint no-param-reassign: 0 */ // --> OFF

require('dotenv').config();

const {	MessengerBot, FileSessionStore, MessengerHandler } = require('bottender');
const { createServer } = require('bottender/restify');
const { MessengerClient } = require('messaging-api-messenger');
// const dialogFlow = require('apiai-promise');
const request = require('request');

const config = require('./bottender.config.js').messenger;
const sendModule = require('./send.js');
const opt = require('./utils/options');
const help = require('./utils/helper');
const { Sentry } = require('./utils/helper');
const broadcast = require('./broadcast.js');
const checkInput = require('./utils/checkInput');

const nutrinetApi = process.env.NUTRINET_API;
const nutrinetApiSecret = process.env.NUTRINET_API_SECRET;

const pageInfo = [];

const mapPageToAccessToken = async (pageId) => {
	const filtered = pageInfo.filter(element => element.page_id === pageId);

	// console.log(process.env.ACCESS_TOKEN);
	// console.log(filtered[0].access_token); // it's not updated yet
	// console.log(pageInfo);

	if (filtered && filtered[0] && filtered[0].access_token) {
		return filtered[0].access_token;
	}

	return false;
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
						broadcast.start(pageInfo[index].client);
					} else {
						pageInfo.push({
							page_id: element.page_id,
							access_token: element.access_token,
							private_jwt_token: element.private_jwt_token,
							client: MessengerClient.connect(element.access_token),
						});
						broadcast.start(pageInfo[pageInfo.length - 1].client);
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
			const currentUser = {};

			if (context.event.isPostback) {
				await context.setState({ lastPBpayload: context.event.postback.payload });
				if (!context.state.dialog || context.state.dialog === '' || context.state.lastPBpayload === 'greetings') { // because of the message that comes from the comment private-reply
					await context.setState({ listenToHorario: false, listenEmail: false });
					await context.setState({ dialog: 'greetings' });
				} else {
					await context.setState({ dialog: context.state.lastPBpayload });
				}
			} else if (context.event.isQuickReply) {
				await context.setState({ lastQRpayload: context.event.message.quick_reply.payload });
				if (context.state.lastQRpayload.slice(0, 7) === 'horario') {
					await context.setState({ dialog: 'mostraHoras' });
				} else if (context.state.lastQRpayload.slice(0, 4) === 'hora') {
					await context.setState({ dialog: 'terminaHora' });
				} else if (context.state.listenEmail === true) {
					await context.setState({ email: context.state.lastQRpayload });
					await checkInput.saveEmail(context);
				} else {
					await context.setState({ dialog: context.state.lastQRpayload });
				} // end quickreply
			} else if (context.event.isText) { // handles text input
				await context.setState({ whatWasTyped: context.event.message.text });
				if (context.state.listenEmail === true) { // user about to enter e-mail
					await context.setState({ email: context.state.whatWasTyped });
					await checkInput.saveEmail(context);
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
			case 'mudarNotificacao':
				await context.setState({ updateNotification: true }); // verifica se estamos atualizando o notification e não configurando pela primeira vez
				// seria legal verificar se o usuário já tem um notification_time antes de enviar ele pra cá
				await context.sendText('Seu horário hoje é XX. Vamos mudar seu horário.');
				// falls throught
			case 'conigurarHorario':
				await context.sendText('Em qual período você está disponível? Clique no botão', { quick_replies: opt.mudarNotificacao });
				break;
			case 'mostraHoras':
				await context.setState({ horarioIndex: context.state.lastQRpayload.replace('horario', '') });
				await context.sendText('Em qual hora? Clique no botão', { quick_replies: opt.mostraHora[context.state.horarioIndex] });
				break;
			case 'terminaHora':
				await context.setState({ horaIndex: context.state.lastQRpayload.replace('hora', '') });
				await context.setState({ notificationTime: `${context.state.horaIndex}:00` });
				if (context.state.updateNotification === true) { // atualizando notificação
					await context.setState({ updateNotification: false });
					await checkInput.saveNotificationTime(context.session.user.id, context.event.rawEvent.recipient.id, context.state.notificationTime);
					await context.sendText('Atualizamos seu horário!');
				} else { // primeira vez que configuramos a notificação
					await checkInput.saveNotificationTime(context.session.user.id, context.event.rawEvent.recipient.id, context.state.notificationTime);
					await help.sendPesquisaCard(context, currentUser, pageInfo);
					// setTimeout(async () => {
				// 	await context.sendText('Sabe o que seria tão legal quanto participar dessa pesquisa? Compartilhar com o maior número de pessoas possível!');
				// 	await context.sendText('[apresentar cards de compartilhar]');
				// }, 3600000);
				}
				break;
			} // end switch de diálogo
		} catch (err) {
			const date = new Date();
			console.log(`\nParece que aconteceu um erro as ${date.toLocaleTimeString('pt-BR')} de ${date.getDate()}/${date.getMonth() + 1} =>`, err);
			await Sentry.configureScope(async (scope) => {
				if (context.session.user && context.session.user.first_name && context.session.user.last_name) {
					scope.setUser({ username: `${context.session.user.first_name} ${context.session.user.last_name}` });
					console.log(`Usuário => ${context.session.user.first_name} ${context.session.user.last_name}`);
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


server.listen(process.env.API_PORT, () => {
	console.log(`Server is running on ${process.env.API_PORT} port...`);
});
