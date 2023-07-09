const fs = require('fs').promises;
const path = require('path');
const process = require('process');
const {authenticate} = require('@google-cloud/local-auth');
const {google} = require('googleapis');


const SCOPES = ['https://mail.google.com/','https://www.googleapis.com/auth/gmail.labels','https://www.googleapis.com/auth/gmail.send','https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/gmail.modify'];

const TOKEN_PATH = path.join(process.cwd(), 'token.json');
const CREDENTIALS_PATH = path.join(process.cwd(), 'credentials.json');

const labelName = "Vacation Auto-mails";

async function loadSavedCredentialsIfExist() {
    try {
      const content = await fs.readFile(TOKEN_PATH);
      const credentials = JSON.parse(content);
      return google.auth.fromJSON(credentials);
    } catch (err) {
      return null;
    }
  }


async function saveCredentials(client) {
    const content = await fs.readFile(CREDENTIALS_PATH);
    const keys = JSON.parse(content);
    const key = keys.installed || keys.web;
    const payload = JSON.stringify({
      type: 'authorized_user',
      client_id: key.client_id,
      client_secret: key.client_secret,
      refresh_token: client.credentials.refresh_token,
    });
    await fs.writeFile(TOKEN_PATH, payload);
}


async function authorize() {
    let client = await loadSavedCredentialsIfExist();
    if (client) {
      return client;
    }
    client = await authenticate({
      scopes: SCOPES,
      keyfilePath: CREDENTIALS_PATH,
    });
    if (client.credentials) {
      await saveCredentials(client);
    }
    return client;
}


async function listLabels(auth) {
    const gmail = google.gmail({version: 'v1', auth});
    const res = await gmail.users.labels.list({
      userId: 'me',
    });
    const labels = res.data.labels;
    if (!labels || labels.length === 0) {
      console.log('No labels found.');
      return;
    }
    console.log('Labels:');
    labels.forEach((label) => {
      console.log(`- ${label.name}`);
    });
}

async function getUnrepliedMessages(auth) {
    const gmail = google.gmail({ version: "v1", auth });
    const response = await gmail.users.messages.list({
      userId: "me",
      labelIds: ["INBOX"],
      q: "is:unread",
    });
    
    return response.data.messages || [];
}

async function createLabel(auth) {
    const gmail = google.gmail({ version: "v1", auth });
    try {
      const response = await gmail.users.labels.create({
        userId: "me",
        requestBody: {
          name: labelName,
          labelListVisibility: "labelShow",
          messageListVisibility: "show",
        },
      });
      return response.data.id;
    } catch (error) {
      if (error.code === 409) {
        const response = await gmail.users.labels.list({
          userId: "me",
        });
        const label = response.data.labels.find(
          (label) => label.name === labelName
        );
        return label.id;
      } else {
        throw error;
      }
    }
}

async function main(auth){
    const labelId = await createLabel(auth);

    setInterval(async () => {
        const gmail = google.gmail({ version: "v1", auth });
        const messages = await getUnrepliedMessages(auth);
        if (messages && messages.length > 0) {
          for (const message of messages) {
            const messageData = await gmail.users.messages.get({
              auth,
              userId: "me",
              id: message.id,
            });
  
            const email = messageData.data;
            const hasReplied = email.payload.headers.some(
              (header) => header.name === "In-Reply-To"
            );
  
            if (!hasReplied) {
              const replyMessage = {
                userId: "me",
                resource: {
                  raw: Buffer.from(
                    `To: ${
                      email.payload.headers.find(
                        (header) => header.name === "From"
                      ).value
                    }\r\n` +
                      `Subject: Re: ${
                        email.payload.headers.find(
                          (header) => header.name === "Subject"
                        ).value
                      }\r\n` +
                      `Content-Type: text/plain; charset="UTF-8"\r\n` +
                      `Content-Transfer-Encoding: 7bit\r\n\r\n` +
                      `Thank you for your email. Just wanted to give you a heads up that I'm currently on a much-needed vacation and I promise to respond to your email promptly upon my return.\r\n`
                  ).toString("base64"),
                },
              };
  
              await gmail.users.messages.send(replyMessage);
  
              // Add label and move the email
              await gmail.users.messages.modify({
                auth,
                userId: "me",
                id: message.id,
                resource: {
                  addLabelIds: [labelId],
                  removeLabelIds: ["INBOX"],
                },
              });
            }
          }
        }
      }, Math.floor(Math.random() * (120 - 45 + 1) + 45) * 1000);
}

authorize().then(main).catch(console.error);
