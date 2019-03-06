// const help = require('./helper');


async function saveEmail(context, user, db) {
	await context.setState({ listenEmail: false });
	const currentUser = user;
	await context.setState({ dialog: 'waiting', time: Date.now() });
	currentUser.email = context.state.email;
	currentUser.session = JSON.stringify(context.state);
	db.put(currentUser, (err, result) => { // eslint-disable-line no-unused-vars
		if (!err) {
			console.log(`Successfully updated ${currentUser._id} with email ${currentUser.email}`);
		} else {
			console.log(err);
		}
	});
	await context.sendText('Obrigada! 😊');
	await context.setState({ dialog: 'perguntar horario' });
}

module.exports.saveEmail = saveEmail;
