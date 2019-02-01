/*
// Broadcast: Each hour check if Lupe posted a news, if yes, send a broadcast message to all users subscribed to a tag related to the news
*/
const async = require('async')

exports.start = function(client, db) {
  //Every hours
  setInterval(checkTime, 3600000);

  async function checkTime() {
    let labelName = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    db.allDocs({include_docs: true, descending: true}, function(err, datad) {
      let filtered = datad.rows.filter(element => {
    		let session = JSON.parse(element.doc.session);
    		return session.dialog === "waiting"
    	})
      filtered.forEach(element => {
        let session = JSON.parse(element.doc.session);
        let diff = hoursBetween(new Date(session.time), new Date())
        if (diff >= 50 && diff < 51) {
          client.getLabelList().then(result => {
            let id;
            let index = result.data.findIndex(function(ele) {
               return ele.name === labelName;
            })
            if (index !== -1) {
              id = result.data[index].id
              client.associateLabel(element.id, id);
              sendBroadcastMessage(id, element.doc.name, element.id);
            }
            else {
              client.createLabel(labelName).then(label => {
                client.associateLabel(element.id, label.id);
                sendBroadcastMessage(label.id, element.doc.name, element.id);
              });
            }
          });
        }
      })
    });
  }

  //Return the number of hours between two dates
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

  function sendBroadcastMessage(labelId, name, userId) {
    let target = { custom_label_id: labelId };
    client.createMessageCreative([
      {
        text: `Olá ${name}. Espero que esteja bem!`,
      }
    ])
    .then(messageId => {
      client.sendBroadcastMessage(messageId.message_creative_id, target)
      .then(broadcast_id => {
        client.createMessageCreative([
        {
          text: "Qual é o melhor horário para você responder à pesquisa?",
        }
      ])
      .then(message2Id => {
        client.sendBroadcastMessage(message2Id.message_creative_id, target)
          .then(broadcast2_id => {
            client.deleteLabel(labelId);
          })
        })
      })
    })
  }
}
