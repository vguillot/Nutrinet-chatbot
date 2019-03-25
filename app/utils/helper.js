const jwt = require('jwt-simple');
const Sentry = require('@sentry/node');
const flow = require('./flow');

const nutrinetSite = process.env.NUTRINET_SITE;
const nutrinetApi = process.env.NUTRINET_API;

Sentry.init({
	dsn: process.env.SENTRY_DSN, environment: process.env.ENV, captureUnhandledRejections: false,
});
module.exports.Sentry = Sentry;

function hoursBetween(date1, date2) {
	// Get 1 hour in milliseconds
	const oneHour = 1000 * 60 * 60;

	// Convert both dates to milliseconds
	const date1Ms = date1.getTime();
	const date2Ms = date2.getTime();

	// Calculate the difference in milliseconds
	const differenceMs = date1Ms - date2Ms;

	// Convert back to days and return
	return (differenceMs / oneHour);
}


async function sendPesquisaCard(context, currentUser, pageInfo) {
	await context.sendText(flow.pesquisaCard.text1);

	const payload = {
		fb_id: context.session.user.id,
		page_id: context.event.rawEvent.recipient.id,
		name: `${context.session.user.first_name} ${context.session.user.last_name}`,
		gender: context.session.user.gender,
		email: context.state.email,
	};
	const filtered = pageInfo.filter(element => element.page_id === context.event.rawEvent.recipient.id);
	const secret = filtered[0] ? filtered[0].private_jwt_token : 'provisorio';
	const token = jwt.encode(payload, secret);
	const card = [{
		title: flow.pesquisaCard.text2,
		image_url: `${nutrinetApi}/static-html-templates/header.jpg`,
		subtitle: flow.pesquisaCard.text3,
		default_action: {
			type: 'web_url',
			url: `${nutrinetSite}?chatbot_token=${token}`,
			messenger_extensions: false,
		},
		buttons: [{
			type: 'web_url',
			url: `${nutrinetSite}?chatbot_token=${token}`,
			title: flow.pesquisaCard.text2,
		}],
	}];
	await context.sendGenericTemplate(card);
}

module.exports.hoursBetween = hoursBetween;
module.exports.sendPesquisaCard = sendPesquisaCard;
