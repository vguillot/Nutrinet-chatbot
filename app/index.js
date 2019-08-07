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
const flow = require('./utils/flow');
const broadcast = require('./broadcast.js');
const checkInput = require('./utils/checkInput');

const nutrinetApi = process.env.NUTRINET_API;
const nutrinetApiSecret = process.env.NUTRINET_API_SECRET;

const pageInfo = [];
let chatbotEnv = '';

const mapPageToAccessToken = async (pageId) => {
	const filtered = pageInfo.filter(element => element.page_id === pageId);

	if (filtered && filtered[0] && filtered[0].access_token) {
		return filtered[0].access_token;
	}

	return false;
};


const bot = new MessengerBot({
	mapPageToAccessToken,
	appSecret: config.appSecret,
	verifyToken: config.verifyToken,
	sessionStore: new FileSessionStore(),
});

bot.setInitialState({});



function getPageInfo() {
	const listAccessTokensUrl = `${nutrinetApi}/maintenance/chatbot-list-access-tokens?secret=${nutrinetApiSecret}`;
	request(listAccessTokensUrl, (error, response, body) => {
		const data = JSON.parse(body);
		chatbotEnv = data.env;
		if (!error && !data.error) {
			for (let i = 0; i < data.pages.length; i++) { // eslint-disable-line no-plusplus
				const element = data.pages[i];
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
			}
		} else {
			const err = error || data.error;
			throw new Error(flow.errorAPI.replace('<error>', err));
		}
	});
}


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
					await context.sendText(flow.errorTyped);
				}
			} // end text

			switch (context.state.dialog) {
			case 'greetings': // primeiro
				await context.sendText(flow.greetings.text1.replace('<username>', context.session.user.first_name));
				await context.sendText(flow.greetings.text2);
				await context.sendText(flow.greetings.text3, { quick_replies: opt.GostaAlimentacaoESaude });
				break;
			case 'Alimentação - Conta mais':
				await context.sendText(flow.alimentacaoMais.text1);
				await context.sendText(flow.alimentacaoMais.text2);
				await context.sendText(flow.alimentacaoMais.text3, { quick_replies: opt.AlimentacaoContaMais });
				break;
			case 'Alimentação - Não':
				await context.sendText(flow.alimentacaoNao.text1);
				await context.sendText(flow.alimentacaoNao.text2, { quick_replies: opt.AlimentacaoNao });
				break;
			case 'Como funciona a pesquisa':
				await context.sendText(flow.comoFunciona.text1, { quick_replies: opt.ComoFuncionaAPesquisa });
				break;
			case 'Como funciona2':
				await context.sendText(flow.comoFunciona.text2);
				await context.sendText(flow.comoFunciona.text3);
				await context.sendText(flow.comoFunciona.text4, { quick_replies: opt.ComoFunciona2 });
				break;
			case 'Quero participar':
				await context.sendText(flow.queroParticipar.text1);
				await context.sendText(flow.queroParticipar.text2);
				try {
					await context.sendText(flow.queroParticipar.askMail, { quick_replies: [{ content_type: 'user_email' }] });
				} catch (err) {
					await context.sendText(flow.queroParticipar.askMail);
				} finally {
					await context.setState({ listenEmail: true });
				}
				break;
			case 'Ainda tenho dúvidas':
				await context.sendText(flow.tenhoDuvidas.text1);
				await context.sendText(flow.tenhoDuvidas.text2);
				await context.sendText(flow.tenhoDuvidas.text3, { quick_replies: opt.AindaTenhoDuvidas });
				break;
			case 'lembrete':
				await context.sendText(flow.lembrete.text1.replace('<username>', context.session.user.first_name));
				await context.sendText(flow.lembrete.text2);
				await context.sendText(flow.lembrete.text3);
				await context.sendText(flow.lembrete.text4);
				await context.sendText(flow.lembrete.text5, { quick_replies: opt.lembrete });
				break;
			case 'Não tenho interesse':
				await context.sendText(flow.semInteresse.text1);
				await context.sendText(flow.semInteresse.text2);
				await context.sendText(flow.semInteresse.text3);
				await context.sendText(flow.semInteresse.text4);
				await context.sendText(flow.semInteresse.text5, { quick_replies: opt.semInteresse });
				break;
			case 'Ver exp curiosidade':
				await context.sendText(flow.verCuriosidade.text1.replace('<username>', context.session.user.first_name));
				await context.sendText(flow.verCuriosidade.text2);
				await context.sendText(flow.verCuriosidade.text3);
				await context.sendText(flow.verCuriosidade.text4);
				break;
			case 'mudarNotificacao':
				await context.setState({ updateNotification: true }); // verifica se estamos atualizando o notification e não configurando pela primeira vez
				// seria legal verificar se o usuário já tem um notification_time antes de enviar ele pra cá
				await context.sendText(flow.notificacao.text1.replace('<notificacao>', 'XXX'));
				// falls throught
			case 'conigurarHorario':
				await context.sendText(flow.notificacao.text2, { quick_replies: opt.mudarNotificacao });
				break;
			case 'mostraHoras':
				await context.setState({ horarioIndex: context.state.lastQRpayload.replace('horario', '') });
				await context.sendText(flow.notificacao.text3, { quick_replies: opt.mostraHora[context.state.horarioIndex] });
				break;
			case 'terminaHora':
				await context.setState({ horaIndex: context.state.lastQRpayload.replace('hora', '') });
				await context.setState({ notificationTime: `${context.state.horaIndex}:00` });
				if (context.state.updateNotification === true) { // atualizando notificação
					await context.setState({ updateNotification: false });
					await checkInput.saveNotificationTime(context.session.user.id, context.event.rawEvent.recipient.id, context.state.notificationTime);
					await context.sendText(flow.notificacao.text4);
				} else { // primeira vez que configuramos a notificação
					await checkInput.saveNotificationTime(context.session.user.id, context.event.rawEvent.recipient.id, context.state.notificationTime);
					await context.setState({ chatbotEnv });
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
		} // catch
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

