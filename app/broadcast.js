/*
// Broadcast: Each hour check if Lupe posted a news, if yes, send a broadcast message to all users subscribed to a tag related to the news
*/
const async = require('async');

exports.start = function (client) { // eslint-disable-line
	// Every hours
	setInterval(checkTime, 3600000);

	async function checkTime() {
		const labelName = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
		db.allDocs({ include_docs: true, descending: true }, (err, datad) => {
			const filtered = datad.rows.filter((element) => {
    		const session = JSON.parse(element.doc.session);
    		return session.dialog === 'waiting';
    	});
			filtered.forEach((element) => {
				const session = JSON.parse(element.doc.session);
				const diff = hoursBetween(new Date(session.time), new Date());
				if (diff >= 50 && diff < 51) {
					client.getLabelList().then((result) => {
						let id;
						const index = result.data.findIndex(ele => ele.name === labelName);
						if (index !== -1) {
							id = result.data[index].id;
							client.associateLabel(element.id, id);
							sendBroadcastMessage(id, element.doc.name, element.id);
						} else {
							client.createLabel(labelName).then((label) => {
								client.associateLabel(element.id, label.id);
								sendBroadcastMessage(label.id, element.doc.name, element.id);
							});
						}
					});
				}
			});
		});
	}

	// Return the number of hours between two dates
	function hoursBetween(date1, date2) {
		// Get 1 hour in milliseconds
		const one_hour = 1000 * 60 * 60;

		// Convert both dates to milliseconds
		const date1_ms = date1.getTime();
		const date2_ms = date2.getTime();

		// Calculate the difference in milliseconds
		const difference_ms = date2_ms - date1_ms;

		// Convert back to days and return
		return (difference_ms / one_hour);
	}

	function sendBroadcastMessage(labelId, name, userId) {
		console.log('AAAAAAAAAAAAAAAAAAAAAAAaa');

		const target = { custom_label_id: labelId };
		client.createMessageCreative([
			{
				text: `Olá ${name}. Espero que esteja bem!`,
			},
		])
			.then((messageId) => {
				client.sendBroadcastMessage(messageId.message_creative_id, target)
					.then((broadcast_id) => {
						client.createMessageCreative([
							{
								text: 'Qual é o melhor horário para você responder à pesquisa?',
							},
						])
							.then((message2Id) => {
								client.sendBroadcastMessage(message2Id.message_creative_id, target)
									.then((broadcast2_id) => {
										client.deleteLabel(labelId);
									});
							});
					});
			});
	}
};
