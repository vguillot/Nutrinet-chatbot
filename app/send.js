/*
// Broadcast: Each hour check if Lupe posted a news, if yes, send a broadcast message to all users subscribed to a tag related to the news
*/
const async = require('async');

exports.send = function (client, idArray, message, callback) {
	prepareTarget();

	async function prepareTarget() {
		const labelName = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
		client.createLabel(labelName).then((label) => {
			idArray.forEach((id) => {
				client.associateLabel(id, label.id);
			});
			sendBroadcastMessage(label.id, (res, errCode) => {
				callback(res, errCode);
			});
		});
	}

	function sendBroadcastMessage(labelId, cb) {
		const target = { custom_label_id: labelId };
		client.createMessageCreative([
			{
				text: message,
			},
		])
			.then((messageId) => {
				client.sendBroadcastMessage(messageId.message_creative_id, target)
					.then((broadcast_id) => {
						client.deleteLabel(labelId);
						cb(broadcast_id);
					}).catch((err) => {
						client.deleteLabel(labelId);
						cb({ error: err.response.data.error }, err.status);
					});
			}).catch((err) => {
				client.deleteLabel(labelId);
				cb({ error: err.response.data.error }, err.status);
			});
	}
};
