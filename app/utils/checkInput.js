// const help = require('./helper');
const request = require('requisition');
const flow = require('./flow');

const nutrinetApi = process.env.NUTRINET_API;
const nutrinetApiSecret = process.env.NUTRINET_API_SECRET;

async function saveEmail(context) {
	await context.setState({ listenEmail: false });
	// context.state.email;
	// JSON.stringify(context.state);

	await context.sendText(flow.saveEmail.text1);
	await context.setState({ dialog: 'conigurarHorario', updateNotification: false });
}

async function saveNotificationTime(fbId, pageId, noticationTime) {
	const res = await request.put(`${nutrinetApi}/maintenance/chatbot-user-preferences?secret=${nutrinetApiSecret}`).query({
		preferences: JSON.stringify({ notification_time: noticationTime }),
		fb_id: fbId,
		page_id: pageId,
	});

	const saveNotification = await res.json();
	console.log('saveNotification', saveNotification);
	return saveNotification;
}

module.exports.saveEmail = saveEmail;
module.exports.saveNotificationTime = saveNotificationTime;
