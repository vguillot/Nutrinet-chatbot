require('dotenv').config();

const { MessengerClient } = require('messaging-api-messenger');
const flow = require('./utils/flow');
const config = require('./bottender.config').messenger;

const client = MessengerClient.connect({
	accessToken: config.accessToken,
	appSecret: config.appSecret,
});

async function createGetStarted() { // eslint-disable-line no-unused-vars
	console.log(await client.setGetStarted('greetings'));
	console.log(await client.setGreeting([{
		locale: 'default',
		text: flow.getStarted,
	}]));
}

async function createPersistentMenu() { // eslint-disable-line no-unused-vars
	console.log(await client.setPersistentMenu([
		{
			locale: 'default',
			call_to_actions: [
				{
					type: 'postback',
					title: 'Ir para o início',
					payload: 'greetings',
				},
				// {
				// 	type: 'postback',
				// 	title: 'Menu',
				// 	payload: 'mainMenu',
				// },
				// {
				// 	type: 'web_url',
				// 	title: 'Example site',
				// 	url: 'http://www.google.com/',
				// },
				{
					type: 'nested',
					title: 'Notificações',
					call_to_actions: [
						{
							type: 'postback',
							title: 'Mudar horário',
							payload: 'mudarNotificacao',
						},
						// {
						// 	type: 'postback',
						// 	title: 'Ligar Notificações 👌',
						// 	payload: 'notificationOn',
						// },
						// {
						// 	type: 'postback',
						// 	title: 'Parar Notificações 🛑',
						// 	payload: 'notificationOff',
						// },
					],
				},
			],
		},
	]));
}

// Each of these functions should be ran from the terminal, with all changes being made right here on the code
// if there's an error just run it again
// Run it => node util/postback.js
createGetStarted();
createPersistentMenu();
