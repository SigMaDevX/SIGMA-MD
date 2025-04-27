import path from 'path';
import { toAudio } from './converter.js';
import chalk from 'chalk';
import fetch from 'node-fetch';
import PhoneNumber from 'awesome-phonenumber';
import fs from 'fs';
import util from 'util';
import { fileTypeFromBuffer } from 'file-type';
import { format } from 'util';
import { fileURLToPath } from 'url';
import store from './store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const {
  default: makeWaSocket,
  makeWALegacySocket,
  proto,
  downloadContentFromMessage,
  jidDecode,
  areJidsSameUser,
  generateForwardMessageContent,
  generateWAMessageFromContent,
  WAMessageStubType,
  extractMessageContent,
  prepareWAMessageMedia
} = (await import("@whiskeysockets/baileys")).default;

export function makeWASocket(connectionOptions, options = {}) {
  let socket = (global.opts.legacy ? makeWALegacySocket : makeWaSocket)(connectionOptions);
  
  let enhancedSocket = Object.defineProperties(socket, {
    'chats': {
      'value': {
        ...(options.chats || {})
      },
      'writable': true
    },
    
    'decodeJid': {
      'value'(jid) {
        if (!jid || typeof jid !== "string") {
          return jid || null;
        }
        return jid.decodeJid();
      }
    },
    
    'logger': {
      'get'() {
        return {
          'info'(...args) {
    console.log(
      chalk.bold.bgRgb(51, 204, 51)("INFO "), 
      '[' + chalk.rgb(255, 255, 255)(new Date().toUTCString()) + ']:', 
      chalk.cyan(format(...args))
    );
},
          
          'error'(...args) {
            console.log(
              chalk.bold.bgRgb(247, 38, 33)("ERROR "), 
              '[' + chalk.rgb(255, 255, 255)(new Date().toUTCString()) + ']:', 
              chalk.rgb(255, 38, 0)(format(...args)))
          },
          
          'warn'(...args) {
            console.log(
              chalk.bold.bgRgb(255, 153, 0)("WARNING "), 
              '[' + chalk.rgb(255, 255, 255)(new Date().toUTCString()) + ']:', 
              chalk.redBright(format(...args)))
          },
          
          'trace'(...args) {
            console.log(
              chalk.grey("TRACE "), 
              '[' + chalk.rgb(255, 255, 255)(new Date().toUTCString()) + ']:', 
              chalk.white(format(...args)))
          },
          
          'debug'(...args) {
            console.log(
              chalk.bold.bgRgb(66, 167, 245)("DEBUG "), 
              '[' + chalk.rgb(255, 255, 255)(new Date().toUTCString()) + ']:', 
              chalk.white(format(...args)))
          }
        };
      },
      'enumerable': true
    },
    
    'getFile': {
      async 'value'(input, saveToFile = false) {
        let response;
        let filename;
        
        const buffer = Buffer.isBuffer(input) ? input : 
          input instanceof ArrayBuffer ? input.toBuffer() :
          /^data:.*?\/.*?;base64,/i.test(input) ? Buffer.from(input.split`,`[1], 'base64') :
          /^https?:\/\//.test(input) ? await (response = await fetch(input)).buffer() :
          fs.existsSync(input) ? (filename = input, fs.readFileSync(input)) : 
          typeof input === 'string' ? input : 
          Buffer.alloc(0);
          
        if (!Buffer.isBuffer(buffer)) {
          throw new TypeError("Result is not a buffer");
        }
        
        const fileInfo = (await fileTypeFromBuffer(buffer)) || {
          'mime': "application/octet-stream",
          'ext': '.bin'
        };
        
        if (buffer && saveToFile && !filename) {
          filename = path.join(__dirname, '../tmp/' + new Date() * 1 + '.' + fileInfo.ext);
          await fs.promises.writeFile(filename, buffer);
        }
        
        return {
          'res': response,
          'filename': filename,
          ...fileInfo,
          'data': buffer,
          'deleteFile'() {
            return filename && fs.promises.unlink(filename);
          }
        };
      },
      'enumerable': true
    },
    
    'waitEvent': {
      'value'(eventName, condition = () => true, maxTries = 25) {
        return new Promise((resolve, reject) => {
          let tries = 0;
          let handler = (...args) => {
            if (++tries > maxTries) {
              reject("Max tries reached");
            } else if (condition()) {
              socket.ev.off(eventName, handler);
              resolve(...args);
            }
          };
          socket.ev.on(eventName, handler);
        });
      }
    },
    
    'sendFile': {
      async 'value'(chatId, filePath, fileName = '', caption = '', quotedMessage, ptt = false, options = {}) {
        let fileData = await socket.getFile(filePath, true);
        let {
          res: fetchResponse,
          data: fileBuffer,
          filename: tempFilePath
        } = fileData;
        
        if (fetchResponse && fetchResponse.status !== 200 || fileBuffer.length <= 65536) {
          try {
            throw {
              'json': JSON.parse(fileBuffer.toString())
            };
          } catch (err) {
            if (err.json) {
              throw err.json;
            }
          }
        }
        
        const fileSizeMB = fs.statSync(tempFilePath).size / 1024 / 1024;
        if (fileSizeMB >= 20000) {
          throw new Error(" ✳️  File size is too large\n\n");
        }
        
        let messageOptions = {};
        if (quotedMessage) {
          messageOptions.quoted = quotedMessage;
        }
        
        if (!fileData) {
          options.asDocument = true;
        }
        
        let messageType = '';
        let mimeType = options.mimetype || fileData.mime;
        let convertedAudio;
        
        if (/webp/.test(fileData.mime) || /image/.test(fileData.mime) && options.asSticker) {
          messageType = "sticker";
        } else if (/image/.test(fileData.mime) || /webp/.test(fileData.mime) && options.asImage) {
          messageType = "image";
        } else if (/video/.test(fileData.mime)) {
          messageType = "video";
        } else if (/audio/.test(fileData.mime)) {
          convertedAudio = await toAudio(fileBuffer, fileData.ext);
          fileBuffer = convertedAudio.data;
          tempFilePath = convertedAudio.filename;
          messageType = 'audio';
          mimeType = options.mimetype || "audio/ogg; codecs=opus";
        } else {
          messageType = "document";
        }
        
        if (options.asDocument) {
          messageType = "document";
        }
        
        delete options.asSticker;
        delete options.asLocation;
        delete options.asVideo;
        delete options.asDocument;
        delete options.asImage;
        
        let messageContent = {
          ...options,
          'caption': caption,
          'ptt': ptt,
          [messageType]: {
            'url': tempFilePath
          },
          'mimetype': mimeType,
          'fileName': fileName || tempFilePath.split('/').pop()
        };
        
        let sentMessage;
        try {
          sentMessage = await socket.sendMessage(chatId, messageContent, {
            ...messageOptions,
            ...options
          });
        } catch (error) {
          console.error(error);
          sentMessage = null;
        } finally {
          if (!sentMessage) {
            sentMessage = await socket.sendMessage(chatId, {
              ...messageContent,
              [messageType]: fileBuffer
            }, {
              ...messageOptions,
              ...options
            });
          }
          fileBuffer = null;
          return sentMessage;
        }
      },
      'enumerable': true
    },
    
    'sendContact': {
      async 'value'(chatId, contacts, quotedMessage, options) {
        if (!Array.isArray(contacts[0]) && typeof contacts[0] === "string") {
          contacts = [contacts];
        }
        
        let vcards = [];
        for (let [phone, name, userId, email, website, label] of contacts) {
          phone = phone.replace(/[^0-9]/g, '');
          let vcard = (`
BEGIN:VCARD
VERSION:3.0
N:Sy;Bot;;;
FN:${name}
item.ORG:Creator Bot
item1.TEL;waid=${userId}:${phone}@s.whatsapp.net
item1.X-ABLabel:${label}
item2.EMAIL;type=INTERNET:${email}
item2.X-ABLabel:Email
item5.URL:${website}
item5.X-ABLabel:Website
END:VCARD
          `).trim();
          
          vcards.push({
            'vcard': vcard,
            'displayName': name
          });
        }
        
        return await socket.sendMessage(chatId, {
          ...options,
          'contacts': {
            ...options,
            'displayName': vcards.length >= 2 ? vcards.length + " contacts" : vcards[0].displayName || null,
            'contacts': vcards
          }
        }, {
          'quoted': quotedMessage,
          ...options
        });
      },
      'enumerable': true
    },
    
    'reply': {
      async 'value'(chatId, content, quotedMessage, options) {
        if (Buffer.isBuffer(content)) {
          return socket.sendFile(chatId, content, "file", '', quotedMessage, false, options);
        } else {
          let newsletterIds = ["120363417971954983@newsletter", "120363417971954983@newsletter", '120363417971954983@newsletter'];
          let newsletterNames = ['SIGMA-MD', "SIGMA-MD 🖤", "SIGMA-MD 💸"];
          
          async function getRandomNewsletter() {
            let randomIndex = Math.floor(Math.random() * newsletterIds.length);
            let id = newsletterIds[randomIndex];
            let name = newsletterNames[randomIndex];
            return {
              'id': id,
              'name': name
            };
          }
          
          let newsletter = await getRandomNewsletter();
          const contextInfo = {
            'mentionedJid': await socket.parseMention(content),
            'isForwarded': true,
            'forwardingScore': 1,
            'forwardedNewsletterMessageInfo': {
              'newsletterJid': newsletter.id,
              'newsletterName': newsletter.name,
              'serverMessageId': 100
            }
          };
          
          const message = {
            ...options,
            'text': content,
            'contextInfo': contextInfo
          };
          
          return socket.sendMessage(chatId, message, {
            'quoted': quotedMessage,
            ...options
          });
        }
      }
    },
    
    'sendButton': {
      async 'value'(chatId, text = '', footer = '', image, buttons, quotedMessage, options) {
        if (Array.isArray(image)) {
          options = quotedMessage;
          quotedMessage = buttons;
          buttons = image;
          image = null;
        }
        
        if (!Array.isArray(buttons[0]) && typeof buttons[0] === 'string') {
          buttons = [buttons];
        }
        
        if (!options) {
          options = {};
        }
        
        let formattedButtons = buttons.map(btn => ({
          'buttonId': btn[1] || btn[0],
          'buttonText': {
            'displayText': btn[0] || ''
          },
          'type': 1
        }));
        
        let messageContent = {
          [image ? "caption" : "text"]: text || '',
          'footer': footer,
          'buttons': formattedButtons,
          'headerType': 4,
          'viewOnce': true,
          ...options,
          ...(image ? {
            'image': {
              'url': typeof image === "string" ? image : undefined
            }
          } : {})
        };
        
        return await socket.sendMessage(chatId, messageContent, {
          'quoted': quotedMessage,
          'upload': socket.waUploadToServer,
          ...options
        });
      },
      'enumerable': true
    },
    
    'sendButton2': {
      async 'value'(chatId, text = '', footer = '', media, buttons, copyText, urlButtons, quotedMessage, options) {
        let imageMessage;
        let videoMessage;
        
        if (/^https?:\/\//i.test(media)) {
          try {
            const response = await fetch(media);
            const contentType = response.headers.get("content-type");
            
            if (/^image\//i.test(contentType)) {
              imageMessage = await prepareWAMessageMedia({
                'image': { 'url': media }
              }, { 'upload': socket.waUploadToServer });
            } else if (/^video\//i.test(contentType)) {
              videoMessage = await prepareWAMessageMedia({
                'video': { 'url': media }
              }, { 'upload': socket.waUploadToServer });
            } else {
              console.error("Unsupported MIME type:", contentType);
            }
          } catch (error) {
            console.error("Error getting MIME type:", error);
          }
        } else {
          try {
            const fileInfo = await socket.getFile(media);
            if (/^image\//i.test(fileInfo.mime)) {
              imageMessage = await prepareWAMessageMedia({
                'image': { 'url': media }
              }, { 'upload': socket.waUploadToServer });
            } else if (/^video\//i.test(fileInfo.mime)) {
              videoMessage = await prepareWAMessageMedia({
                'video': { 'url': media }
              }, { 'upload': socket.waUploadToServer });
            }
          } catch (error) {
            console.error("Error getting file type:", error);
          }
        }

        const formattedButtons = buttons.map(btn => ({
          'name': "quick_reply",
          'buttonParamsJson': JSON.stringify({
            'display_text': btn[0],
            'id': btn[1]
          })
        }));

        if (copyText && (typeof copyText === "string" || typeof copyText === "number")) {
          formattedButtons.push({
            'name': "cta_copy",
            'buttonParamsJson': JSON.stringify({
              'display_text': "Copy",
              'copy_code': copyText
            })
          });
        }

        if (urlButtons && Array.isArray(urlButtons)) {
          urlButtons.forEach(btn => {
            formattedButtons.push({
              'name': 'cta_url',
              'buttonParamsJson': JSON.stringify({
                'display_text': btn[0],
                'url': btn[1],
                'merchant_url': btn[1]
              })
            });
          });
        }

        const interactiveMessage = {
          'body': { 'text': text },
          'footer': { 'text': footer },
          'header': {
            'hasMediaAttachment': false,
            'imageMessage': imageMessage ? imageMessage.imageMessage : null,
            'videoMessage': videoMessage ? videoMessage.videoMessage : null
          },
          'nativeFlowMessage': {
            'buttons': formattedButtons,
            'messageParamsJson': ''
          }
        };

        let message = generateWAMessageFromContent(chatId, {
          'viewOnceMessage': {
            'message': {
              'interactiveMessage': interactiveMessage
            }
          }
        }, {
          'userJid': socket.user.jid,
          'quoted': quotedMessage
        });

        socket.relayMessage(chatId, message.message, {
          'messageId': message.key.id,
          ...options
        });
      },
      'enumerable': true
    },

    'sendList': {
      async 'value'(chatId, title, description, buttonText, media, sections, quotedMessage, options = {}) {
        let imageMessage;
        let videoMessage;

        if (/^https?:\/\//i.test(media)) {
          try {
            const response = await fetch(media);
            const contentType = response.headers.get("content-type");
            
            if (/^image\//i.test(contentType)) {
              imageMessage = await prepareWAMessageMedia({
                'image': { 'url': media }
              }, { 'upload': socket.waUploadToServer });
            } else if (/^video\//i.test(contentType)) {
              videoMessage = await prepareWAMessageMedia({
                'video': { 'url': media }
              }, { 'upload': socket.waUploadToServer });
            } else {
              console.error("Unsupported MIME type:", contentType);
            }
          } catch (error) {
            console.error("Error getting MIME type:", error);
          }
        } else {
          try {
            const fileInfo = await socket.getFile(media);
            if (/^image\//i.test(fileInfo.mime)) {
              imageMessage = await prepareWAMessageMedia({
                'image': { 'url': media }
              }, { 'upload': socket.waUploadToServer });
            } else if (/^video\//i.test(fileInfo.mime)) {
              videoMessage = await prepareWAMessageMedia({
                'video': { 'url': media }
              }, { 'upload': socket.waUploadToServer });
            }
          } catch (error) {
            console.error("Error getting file type:", error);
          }
        }

        const formattedSections = [...sections];
        
        const interactiveMessage = {
          'interactiveMessage': {
            'header': {
              'title': title,
              'hasMediaAttachment': false,
              'imageMessage': imageMessage ? imageMessage.imageMessage : null,
              'videoMessage': videoMessage ? videoMessage.videoMessage : null
            },
            'body': {
              'text': description
            },
            'nativeFlowMessage': {
              'buttons': [{
                'name': "single_select",
                'buttonParamsJson': JSON.stringify({
                  'title': buttonText,
                  'sections': formattedSections
                })
              }],
              'messageParamsJson': ''
            }
          }
        };

        let message = generateWAMessageFromContent(chatId, {
          'viewOnceMessage': {
            'message': interactiveMessage
          }
        }, {
          'userJid': socket.user.jid,
          'quoted': quotedMessage
        });

        socket.relayMessage(chatId, message.message, {
          'messageId': message.key.id,
          ...options
        });
      },
      'enumerable': true
    },

    'sendListM': {
      async 'value'(chatId, listInfo, rows, quotedMessage, options = {}) {
        const sections = [{
          'title': listInfo.title,
          'rows': [...rows]
        }];

        const messageContent = {
          'text': listInfo.description,
          'footer': listInfo.footerText,
          'mentions': await socket.parseMention(listInfo.description),
          'title': '',
          'buttonText': listInfo.buttonText,
          'sections': sections
        };

        socket.sendMessage(chatId, messageContent, {
          'quoted': quotedMessage
        });
      },
      'enumerable': true
    },

    'updateProfileStatus': {
      async 'value'(statusText) {
        return socket.query({
          'tag': 'iq',
          'attrs': {
            'to': "s.whatsapp.net",
            'type': "set",
            'xmlns': "status"
          },
          'content': [{
            'tag': "status",
            'attrs': {},
            'content': Buffer.from(statusText, "utf-8")
          }]
        });
      },
      'enumerable': true
    },

    'sendPayment': {
      async 'value'(chatId, amount, currency = "USD", note = '', requestFrom = "0@s.whatsapp.net", options) {
        const paymentMessage = {
          'amount': {
            'currencyCode': currency || "USD",
            'offset': 0,
            'value': amount || 9.99
          },
          'expiryTimestamp': 0,
          'amount1000': (amount || 9.99) * 1000,
          'currencyCodeIso4217': currency || 'USD',
          'requestFrom': requestFrom || "0@s.whatsapp.net",
          'noteMessage': {
            'extendedTextMessage': {
              'text': note || "Example Payment Message"
            }
          }
        };

        return socket.relayMessage(chatId, {
          'requestPaymentMessage': paymentMessage
        }, {
          ...options
        });
      },
      'enumerable': true
    },

    'sendPoll': {
      async 'value'(chatId, question = '', options, pollOptions = {}) {
        if (!Array.isArray(options[0]) && typeof options[0] === 'string') {
          options = [options];
        }

        if (!pollOptions) {
          pollOptions = {};
        }

        const pollMessage = {
          'name': question,
          'options': options.map(opt => ({
            'optionName': opt[0] || ''
          })),
          'selectableOptionsCount': 1
        };

        return socket.relayMessage(chatId, {
          'pollCreationMessage': pollMessage
        }, {
          ...pollOptions
        });
      },
      'enumerable': true
    },

    'loadingMsg': {
      async 'value'(chatId, initialText, finalText, loadingMessages, quotedMessage, options) {
        let { key: messageKey } = await socket.sendMessage(chatId, {
          'text': initialText,
          ...options
        }, {
          'quoted': quotedMessage
        });

        for (let i = 0; i < loadingMessages.length; i++) {
          await socket.sendMessage(chatId, {
            'text': loadingMessages[i],
            'edit': messageKey,
            ...options
          }, {
            'quoted': quotedMessage
          });
        }

        await socket.sendMessage(chatId, {
          'text': finalText,
          'edit': messageKey,
          ...options
        }, {
          'quoted': quotedMessage
        });
      },
      'enumerable': true
    },

    'sendHydrated': {
      async 'value'(chatId, text = '', footer = '', media, urlButtons, callButtons, quickReplyButtons, quotedMessage, options) {
        let mediaInfo;
        
        if (media) {
          try {
            mediaInfo = await socket.getFile(media);
            media = mediaInfo.data;
          } catch {
            media = media;
          }
        }

        if (media && !Buffer.isBuffer(media) && (typeof media === "string" || Array.isArray(media))) {
          options = quotedMessage;
          quotedMessage = quickReplyButtons;
          quickReplyButtons = callButtons;
          callButtons = urlButtons;
          urlButtons = media;
          media = null;
        }

        if (!options) {
          options = {};
        }

        let templateButtons = [];
        
        // URL buttons processing
        if (urlButtons) {
          if (!Array.isArray(urlButtons)) {
            urlButtons = [urlButtons];
          }
          if (callButtons && !Array.isArray(callButtons)) {
            callButtons = [callButtons];
          }
          
          templateButtons.push(...(
            urlButtons.map((url, i) => [url, callButtons?.[i]]).map(([url, text], i) => ({
              'index': templateButtons.length + i + 1,
              'urlButton': {
                'displayText': text || url || '',
                'url': url || text || ''
              }
            })) || []
          ));
        }

        // Call buttons processing
        if (callButtons) {
          if (!Array.isArray(callButtons)) {
            callButtons = [callButtons];
          }
          if (quickReplyButtons && !Array.isArray(quickReplyButtons)) {
            quickReplyButtons = [quickReplyButtons];
          }
          
          templateButtons.push(...(
            callButtons.map((number, i) => [number, quickReplyButtons?.[i]]).map(([number, text], i) => ({
              'index': templateButtons.length + i + 1,
              'callButton': {
                'displayText': text || number || '',
                'phoneNumber': number || text || ''
              }
            })) || []
          ));
        }

        // Quick reply buttons processing
        if (quickReplyButtons?.length) {
          if (!Array.isArray(quickReplyButtons[0])) {
            quickReplyButtons = [quickReplyButtons];
          }
          
          templateButtons.push(...(
            quickReplyButtons.map(([text, id], i) => ({
              'index': templateButtons.length + i + 1,
              'quickReplyButton': {
                'displayText': text || id || '',
                'id': id || text || ''
              }
            })) || []
          ));
        }

        let messageContent = {
          ...options,
          [media ? "caption" : "text"]: text || '',
          'footer': footer,
          'templateButtons': templateButtons,
          ...(media ? {
            [mediaInfo?.mime?.startsWith('video/') ? "video" : 
             mediaInfo?.mime?.startsWith('image/') ? "image" : "document"]: media
          } : {})
        };

        return await socket.sendMessage(chatId, messageContent, {
          'quoted': quotedMessage,
          'upload': socket.waUploadToServer,
          ...options
        });
      },
      'enumerable': true
    },

    'sendHydrated2': {
      async 'value'(chatId, text = '', footer = '', media, urlButtons, callButtons, quickReplyButtons, quotedMessage, options) {
        let mediaInfo;
        if (media) {
          try {
            mediaInfo = await socket.getFile(media);
            media = mediaInfo.data;
          } catch {
            media = media;
          }
        }

        // Parameter rearrangement if media is actually buttons data
        if (media && !Buffer.isBuffer(media) && (typeof media === "string" || Array.isArray(media))) {
          options = quotedMessage;
          quotedMessage = quickReplyButtons;
          quickReplyButtons = callButtons;
          callButtons = urlButtons;
          urlButtons = media;
          media = null;
        }

        if (!options) {
          options = {};
        }

        let templateButtons = [];
        
        // Process URL buttons
        if (urlButtons) {
          if (!Array.isArray(urlButtons)) {
            urlButtons = [urlButtons];
          }
          if (callButtons && !Array.isArray(callButtons)) {
            callButtons = [callButtons];
          }
          
          templateButtons.push(...(
            urlButtons.map((url, i) => [url, callButtons?.[i]]).map(([url, text], i) => ({
              'index': templateButtons.length + i + 1,
              'urlButton': {
                'displayText': text || url || '',
                'url': url || text || ''
              }
            })) || []
          ));
        }

        // Process call buttons
        if (callButtons) {
          if (!Array.isArray(callButtons)) {
            callButtons = [callButtons];
          }
          
          templateButtons.push(...(
            callButtons.map((number, i) => [number, quickReplyButtons?.[i]]).map(([number, text], i) => ({
              'index': templateButtons.length + i + 1,
              'callButton': {
                'displayText': text || number || '',
                'phoneNumber': number || text || ''
              }
            })) || []
          ));
        }

        // Process quick reply buttons
        if (quickReplyButtons?.length) {
          if (!Array.isArray(quickReplyButtons[0])) {
            quickReplyButtons = [quickReplyButtons];
          }
          
          templateButtons.push(...(
            quickReplyButtons.map(([text, id], i) => ({
              'index': templateButtons.length + i + 1,
              'quickReplyButton': {
                'displayText': text || id || '',
                'id': id || text || ''
              }
            })) || []
          ));
        }

        let messageContent = {
          ...options,
          [media ? "caption" : "text"]: text || '',
          'footer': footer,
          'templateButtons': templateButtons,
          ...(media ? {
            'location': options.asLocation && /image/.test(mediaInfo.mime) ? {
              ...options,
              'jpegThumbnail': media
            } : {
              [/video/.test(mediaInfo.mime) ? "video" : 
               /image/.test(mediaInfo.mime) ? "image" : "document"]: media
            }
          } : {})
        };

        return await socket.sendMessage(chatId, messageContent, {
          'quoted': quotedMessage,
          'upload': socket.waUploadToServer,
          ...options
        });
      },
      'enumerable': true
    },

    'cMod': {
      'value'(chatId, message, newText = '', sender = socket.user.jid, options = {}) {
        if (options.mentions && !Array.isArray(options.mentions)) {
          options.mentions = [options.mentions];
        }

        let messageObj = message.toJSON();
        delete messageObj.message.messageContextInfo;
        delete messageObj.message.senderKeyDistributionMessage;

        let messageType = Object.keys(messageObj.message)[0];
        let messageContent = messageObj.message[messageType];

        // Update message content
        if (typeof messageContent === "string") {
          messageObj.message[messageType] = newText || messageContent;
        } else if (messageContent.caption) {
          messageContent.caption = newText || messageContent.caption;
        } else if (messageContent.text) {
          messageContent.text = newText || messageContent.text;
        }

        // Apply modifications
        if (typeof messageContent !== "string") {
          messageObj.message[messageType] = {
            ...messageContent,
            ...options
          };
          
          messageObj.message[messageType].contextInfo = {
            ...(messageContent.contextInfo || {}),
            'mentionedJid': options.mentions || messageContent.contextInfo?.mentionedJid || []
          };
        }

        // Update sender information
        if (messageObj.participant) {
          sender = messageObj.participant = sender || messageObj.participant;
        } else if (messageObj.key.participant) {
          sender = messageObj.key.participant = sender || messageObj.key.participant;
        }

        // Update remoteJid
        if (messageObj.key.remoteJid.includes('@s.whatsapp.net')) {
          sender = sender || messageObj.key.remoteJid;
        } else if (messageObj.key.remoteJid.includes("@broadcast")) {
          sender = sender || messageObj.key.remoteJid;
        }

        messageObj.key.remoteJid = chatId;
        messageObj.key.fromMe = areJidsSameUser(sender, socket.user.id) || false;

        return proto.WebMessageInfo.fromObject(messageObj);
      },
      'enumerable': true
    },

    'copyNForward': {
      async 'value'(chatId, message, forward = true, options = {}) {
        let messageType;
        
        // Handle view-once messages
        if (options.readViewOnce && message.message.viewOnceMessage?.message) {
          messageType = Object.keys(message.message.viewOnceMessage.message)[0];
          delete message.message.viewOnceMessage.message[messageType].viewOnce;
          message.message = proto.Message.fromObject(
            JSON.parse(JSON.stringify(message.message.viewOnceMessage.message))
          );
          message.message[messageType].contextInfo = message.message.viewOnceMessage.contextInfo;
        }

        let originalType = Object.keys(message.message)[0];
        let forwardedContent = generateForwardMessageContent(message, !!forward);
        let forwardedType = Object.keys(forwardedContent)[0];

        // Increase forwarding score if specified
        if (forward && typeof forward === "number" && forward > 1) {
          forwardedContent[forwardedType].contextInfo.forwardingScore += forward;
        }

        // Merge context info
        forwardedContent[forwardedType].contextInfo = {
          ...(message.message[originalType].contextInfo || {}),
          ...(forwardedContent[forwardedType].contextInfo || {})
        };

        // Generate final message
        forwardedContent = generateWAMessageFromContent(chatId, forwardedContent, {
          ...options,
          'userJid': socket.user.jid
        });

        await socket.relayMessage(chatId, forwardedContent.message, {
          'messageId': forwardedContent.key.id,
          'additionalAttributes': {
            ...options
          }
        });

        return forwardedContent;
      },
      'enumerable': true
    },

    'fakeReply': {
      'value'(chatId, text = '', sender = socket.user.jid, fakeMessage = '', remoteJid, options) {
        return socket.reply(chatId, text, {
          'key': {
            'fromMe': areJidsSameUser(sender, socket.user.id),
            'participant': sender,
            ...(remoteJid ? { 'remoteJid': remoteJid } : {})
          },
          'message': {
            'conversation': fakeMessage
          },
          ...options
        });
      },
      'enumerable': true
    },

    'downloadM': {
      async 'value'(mediaMessage, type, saveToFile) {
        let filename;
        
        if (!mediaMessage || !(mediaMessage.url || mediaMessage.directPath)) {
          return Buffer.alloc(0);
        }

        const downloadStream = await downloadContentFromMessage(mediaMessage, type);
        let buffer = Buffer.from([]);

        for await (const chunk of downloadStream) {
          buffer = Buffer.concat([buffer, chunk]);
        }

        if (saveToFile) {
          ({ filename } = await socket.getFile(buffer, true));
        }

        return saveToFile && fs.existsSync(filename) ? filename : buffer;
      },
      'enumerable': true
    },

    'parseMention': {
      'value'(text = '') {
        return [...text.matchAll(/@([0-9]{5,16}|0)/g)]
          .map(match => match[1] + '@s.whatsapp.net');
      },
      'enumerable': true
    },

    'getName': {
      'value'(jid = '', useNumber = false) {
        jid = socket.decodeJid(jid);
        useNumber = socket.withoutContact || useNumber;

        let contact;
        
        if (jid.endsWith("@g.us")) {
          return new Promise(async resolve => {
            contact = socket.chats[jid] || {};
            
            if (!(contact.name || contact.subject)) {
              contact = (await socket.groupMetadata(jid)) || {};
            }
            
            resolve(
              contact.name || 
              contact.subject || 
              PhoneNumber('+' + jid.replace("@s.whatsapp.net", ''))
                .getNumber('international')
            );
          });
        } else {
          contact = jid === '0@s.whatsapp.net' ? {
            'jid': jid,
            'vname': 'WhatsApp'
          } : areJidsSameUser(jid, socket.user.id) ? 
            socket.user : 
            socket.chats[jid] || {};
        }

        return (useNumber ? '' : contact.name) || 
               contact.subject || 
               contact.vname || 
               contact.notify || 
               contact.verifiedName || 
               PhoneNumber('+' + jid.replace("@s.whatsapp.net", ''))
                 .getNumber("international");
      },
      'enumerable': true
    },

    'loadMessage': {
      'value'(messageId) {
        return Object.entries(socket.chats)
          .filter(([_, { messages }]) => typeof messages === 'object')
          .find(([_, { messages }]) => 
            Object.entries(messages).find(([id, msg]) => 
              id === messageId || msg.key?.id === messageId
            )
          )?.[1]?.messages?.[messageId];
      },
      'enumerable': true
    },
        
'sendGroupV4Invite': {
      async 'value'(groupId, inviteTo, inviteCode, expiryTime, groupName = "unknown subject", caption = "Invitation to join my WhatsApp group", thumbnail, options = {}) {
        const inviteMessage = proto.Message.fromObject({
          'groupInviteMessage': proto.GroupInviteMessage.fromObject({
            'inviteCode': inviteCode,
            'inviteExpiration': parseInt(expiryTime) || +new Date(Date.now() + 259200000),
            'groupJid': groupId,
            'groupName': groupName || await socket.getName(groupId) || null,
            'jpegThumbnail': Buffer.isBuffer(thumbnail) ? thumbnail : null,
            'caption': caption
          })
        });

        const inviteContent = generateWAMessageFromContent(inviteTo, inviteMessage, options);
        
        await socket.relayMessage(inviteTo, inviteContent.message, {
          'messageId': inviteContent.key.id,
          'additionalAttributes': {
            ...options
          }
        });

        return inviteContent;
      },
      'enumerable': true
    },

    'processMessageStubType': {
      async 'value'(message) {
        if (!message.messageStubType) return;
        
        const chatId = socket.decodeJid(
          message.key.remoteJid || 
          message.message?.senderKeyDistributionMessage?.groupId || 
          ''
        );
        
        if (!chatId || chatId === "status@broadcast") return;

        const updateGroup = (update) => {
          socket.ev.emit('groups.update', [{
            'id': chatId,
            ...update
          }]);
        };

        switch (message.messageStubType) {
          case WAMessageStubType.REVOKE:
          case WAMessageStubType.GROUP_CHANGE_INVITE_LINK:
            updateGroup({ 'revoke': message.messageStubParameters[0] });
            break;
            
          case WAMessageStubType.GROUP_CHANGE_ICON:
            updateGroup({ 'icon': message.messageStubParameters[0] });
            break;
            
          default:
            console.log({
              'messageStubType': message.messageStubType,
              'messageStubParameters': message.messageStubParameters,
              'type': WAMessageStubType[message.messageStubType]
            });
            break;
        }

        if (!chatId.endsWith("@g.us")) return;

        let chat = socket.chats[chatId];
        if (!chat) {
          chat = socket.chats[chatId] = { 'id': chatId };
        }

        chat.isChats = true;
        const metadata = await socket.groupMetadata(chatId).catch(() => null);
        if (!metadata) return;

        chat.subject = metadata.subject;
        chat.metadata = metadata;
      },
      'enumerable': true
    },

    'insertAllGroup': {
      async 'value'() {
        const groups = (await socket.groupFetchAllParticipating().catch(() => null)) || {};
        
        for (const groupId in groups) {
          socket.chats[groupId] = {
            ...(socket.chats[groupId] || {}),
            'id': groupId,
            'subject': groups[groupId].subject,
            'isChats': true,
            'metadata': groups[groupId]
          };
        }
        
        return socket.chats;
      },
      'enumerable': true
    },

    'pushMessage': {
      async 'value'(messages) {
        if (!messages) return;
        if (!Array.isArray(messages)) messages = [messages];

        for (const message of messages) {
          try {
            if (!message) continue;

            // Handle message stub types (group changes, etc)
            if (message.messageStubType && message.messageStubType != WAMessageStubType.CIPHERTEXT) {
              socket.processMessageStubType(message).catch(console.error);
            }

            // Extract the actual message content type
            const messageTypes = Object.keys(message.message || {});
            const messageType = !["senderKeyDistributionMessage", "messageContextInfo"].includes(messageTypes[0]) ? 
              messageTypes[0] : 
              messageTypes.length >= 3 && messageTypes[1] !== "messageContextInfo" ? 
                messageTypes[1] : 
                messageTypes[messageTypes.length - 1];

            const chatId = socket.decodeJid(
              message.key.remoteJid || 
              message.message?.senderKeyDistributionMessage?.groupId || 
              ''
            );

            // Process quoted messages
            if (message.message?.[messageType]?.contextInfo?.quotedMessage) {
              const contextInfo = message.message[messageType].contextInfo;
              const participant = socket.decodeJid(contextInfo.participant);
              const quotedChatId = socket.decodeJid(contextInfo.remoteJid || participant);
              let quotedMessage = message.message[messageType].contextInfo.quotedMessage;

              if (quotedChatId && quotedChatId !== 'status@broadcast' && quotedMessage) {
                let quotedType = Object.keys(quotedMessage)[0];
                
                // Convert conversation messages to extendedText
                if (quotedType == "conversation") {
                  quotedMessage.extendedTextMessage = { 'text': quotedMessage[quotedType] };
                  delete quotedMessage.conversation;
                  quotedType = 'extendedTextMessage';
                }

                if (!quotedMessage[quotedType].contextInfo) {
                  quotedMessage[quotedType].contextInfo = {};
                }

                quotedMessage[quotedType].contextInfo.mentionedJid = 
                  contextInfo.mentionedJid || 
                  quotedMessage[quotedType].contextInfo.mentionedJid || 
                  [];

                const isGroup = quotedChatId.endsWith("g.us");
                const sender = isGroup && !participant ? quotedChatId : participant;

                const quotedMsgObj = {
                  'key': {
                    'remoteJid': quotedChatId,
                    'fromMe': areJidsSameUser(socket.user.jid, quotedChatId),
                    'id': contextInfo.stanzaId,
                    'participant': sender
                  },
                  'message': JSON.parse(JSON.stringify(quotedMessage)),
                  ...(isGroup ? { 'participant': sender } : {})
                };

                let quotedChat = socket.chats[sender];
                if (!quotedChat) {
                  quotedChat = socket.chats[sender] = {
                    'id': sender,
                    'isChats': !isGroup
                  };
                }

                if (!quotedChat.messages) {
                  quotedChat.messages = {};
                }

                if (!quotedChat.messages[contextInfo.stanzaId] && !quotedMsgObj.key.fromMe) {
                  quotedChat.messages[contextInfo.stanzaId] = quotedMsgObj;
                }

                // Limit message history
                const messageEntries = Object.entries(quotedChat.messages);
                if (messageEntries.length > 40) {
                  quotedChat.messages = Object.fromEntries(messageEntries.slice(20, messageEntries.length));
                }
              }
            }

            if (!chatId || chatId === "status@broadcast") continue;

            const isGroup = chatId.endsWith("@g.us");
            let chat = socket.chats[chatId];

            if (!chat) {
              if (isGroup) {
                await socket.insertAllGroup().catch(console.error);
              }
              chat = socket.chats[chatId] = {
                'id': chatId,
                'isChats': true,
                ...(socket.chats[chatId] || {})
              };
            }

            let sender;
            if (isGroup) {
              if (!chat.subject || !chat.metadata) {
                const metadata = (await socket.groupMetadata(chatId).catch(() => ({}))) || {};
                chat.subject = metadata.subject || chat.subject || '';
                chat.metadata = metadata;
              }
              
              sender = socket.decodeJid(
                message.key?.fromMe && socket.user.id || 
                message.participant || 
                message.key?.participant || 
                chatId || 
                ''
              );

              if (sender !== chatId) {
                let senderChat = socket.chats[sender];
                if (!senderChat) {
                  senderChat = socket.chats[sender] = { 'id': sender };
                }
                if (!senderChat.name) {
                  senderChat.name = message.pushName || senderChat.name || '';
                }
              }
            } else {
              if (!chat.name) {
                chat.name = message.pushName || chat.name || '';
              }
            }

            if (['senderKeyDistributionMessage', "messageContextInfo"].includes(messageType)) {
              continue;
            }

            chat.isChats = true;
            if (!chat.messages) {
              chat.messages = {};
            }

            const isFromMe = message.key.fromMe || 
                            areJidsSameUser(sender || chatId, socket.user.id);

            if (!["protocolMessage"].includes(messageType) && 
                !isFromMe && 
                message.messageStubType != WAMessageStubType.CIPHERTEXT && 
                message.message) {
              
              delete message.message.messageContextInfo;
              delete message.message.senderKeyDistributionMessage;
              
              chat.messages[message.key.id] = JSON.parse(JSON.stringify(message, null, 2));
              
              // Limit message history
              const messageEntries = Object.entries(chat.messages);
              if (messageEntries.length > 40) {
                chat.messages = Object.fromEntries(messageEntries.slice(20, messageEntries.length));
              }
            }
          } catch (error) {
            console.error(error);
          }
        }
      },
      'enumerable': true
    },

    'serializeM': {
      'value'(message) {
        return smsg(socket, message);
      },
      'enumerable': true
    },

    ...(typeof socket.chatRead !== "function" ? {
      'chatRead': {
        'value'(chatId, readBy = socket.user.jid, messageId) {
          return socket.sendReadReceipt(chatId, readBy, [messageId]);
        },
        'enumerable': true
      }
    } : {}),

    ...(typeof socket.setStatus !== "function" ? {
      'setStatus': {
        'value'(statusText) {
          return socket.query({
            'tag': 'iq',
            'attrs': {
              'to': "s.whatsapp.net",
              'type': "set",
              'xmlns': "status"
            },
            'content': [{
              'tag': 'status',
              'attrs': {},
              'content': Buffer.from(statusText, "utf-8")
            }]
          });
        },
        'enumerable': true
      }
    } : {})
  });

  if (enhancedSocket.user?.id) {
    enhancedSocket.user.jid = enhancedSocket.decodeJid(enhancedSocket.user.id);
  }

  store.bind(enhancedSocket);
  return enhancedSocket;
}

// Message serialization function
export function smsg(conn, message, serialize = true) {
  if (!message) return message;
  
  let M = proto.WebMessageInfo;
  message = M.fromObject(message);
  message.conn = conn;

  if (message.message) {
    let key;
    if (message.mtype == "protocolMessage" && message.msg.key) {
      key = message.msg.key;
      if (key == 'status@broadcast') {
        key.remoteJid = message.chat;
      }
      if (!key.participant || key.participant == 'status_me') {
        key.participant = message.sender;
      }
      key.fromMe = conn.decodeJid(key.participant) === conn.decodeJid(conn.user.id);
      if (!key.fromMe && key.remoteJid === conn.decodeJid(conn.user.id)) {
        key.remoteJid = message.sender;
      }
    }

    if (message.quoted && !message.quoted.mediaMessage) {
      delete message.quoted.download;
    }
  }

  if (!message.mediaMessage) {
    delete message.download;
  }

  try {
    if (message.mtype == "protocolMessage") {
      conn.ev.emit("message.delete", message.msg.key);
    }
  } catch (e) {
    console.error(e);
  }

  return message;
}

// Serialization utilities
export function serialize() {
  const mediaTypes = ["imageMessage", "videoMessage", "audioMessage", "stickerMessage", "documentMessage"];

  return Object.defineProperties(proto.WebMessageInfo.prototype, {
    'conn': {
      'value': undefined,
      'enumerable': false,
      'writable': true
    },
    
    'id': {
      'get'() { return this.key?.id; }
    },
    
    'isBaileys': {
      'get'() {
        return this.id?.length === 16 || 
              (this.id?.startsWith('3EB0') && this.id?.length === 12) || 
              false;
      }
    },
    
    'chat': {
      'get'() {
        const groupId = this.message?.senderKeyDistributionMessage?.groupId;
        return (this.key?.remoteJid || (groupId && groupId !== "status@broadcast") || '').decodeJid();
      }
    },
    
    'isGroup': {
      'get'() { return this.chat.endsWith("@g.us"); },
      'enumerable': true
    },
    
    'sender': {
      'get'() {
        return this.conn?.decodeJid(
          this.key?.fromMe && this.conn?.user.id || 
          this.participant || 
          this.key.participant || 
          this.chat || 
          ''
        );
      },
      'enumerable': true
    },
    
    'fromMe': {
      'get'() {
        return this.key?.fromMe || 
              areJidsSameUser(this.conn?.user.id, this.sender) || 
              false;
      }
    },
    
    'mtype': {
      'get'() {
        if (!this.message) return '';
        const types = Object.keys(this.message);
        return !["senderKeyDistributionMessage", "messageContextInfo"].includes(types[0]) ? 
          types[0] : 
          types.length >= 3 && types[1] !== "messageContextInfo" ? 
            types[1] : 
            types[types.length - 1];
      },
      'enumerable': true
    },
    
    'msg': {
      'get'() {
        if (!this.message) return null;
        return this.message[this.mtype];
      }
    },
    
    'mediaMessage': {
      'get'() {
        if (!this.message) return null;
        
        const content = (this.msg?.url || this.msg?.directPath ? 
          { ...this.message } : 
          extractMessageContent(this.message)) || null;
        
        if (!content) return null;
        
        const type = Object.keys(content)[0];
        return mediaTypes.includes(type) ? content : null;
      },
      'enumerable': true
    },
    
    'mediaType': {
      'get'() {
        return this.mediaMessage ? Object.keys(this.mediaMessage)[0] : null;
      },
      'enumerable': true
    },
    
    'quoted': {
      'get'() {
        const msg = this.msg;
        const context = msg?.contextInfo;
        const quotedMsg = context?.quotedMessage;
        
        if (!msg || !context || !quotedMsg) return null;
        
        const quotedType = Object.keys(quotedMsg)[0];
        let quotedContent = quotedMsg[quotedType];
        const quotedText = typeof quotedContent === 'string' ? quotedContent : quotedContent.text;
        
        return Object.defineProperties(JSON.parse(JSON.stringify(
          typeof quotedContent === "string" ? { 'text': quotedContent } : quotedContent
        )), {
          'conn': { 'value': this.conn },
          'id': { 'get'() { return context.stanzaId; } },
          'chat': { 'get'() { return context.remoteJid.decodeJid(); } },
          'isGroup': { 'get'() { return this.chat.endsWith("@g.us"); } },
          'sender': { 'get'() { return context.participant.decodeJid(); } },
          'fromMe': { 'get'() { return areJidsSameUser(this.sender, this.conn.user.id); } },
          'text': { 'get'() { return quotedText; } },
          'mentionedJid': { 'get'() { return context.mentionedJid || []; } }
        });
      },
      'enumerable': true
    }
  });
}

// Utility functions
export function logic(check, inputs, outputs) {
  if (inputs.length !== outputs.length) {
    throw new Error("Input and Output must have same length");
  }
  
  for (let i in inputs) {
    if (util.isDeepStrictEqual(check, inputs[i])) {
      return outputs[i];
    }
  }
  return null;
}

export function protoType() {
  // Buffer extensions
  Buffer.prototype.toArrayBuffer = function() {
    const buffer = new ArrayBuffer(this.length);
    const view = new Uint8Array(buffer);
    for (let i = 0; i < this.length; ++i) {
      view[i] = this[i];
    }
    return buffer;
  };
  
  Buffer.prototype.toArrayBufferV2 = function() {
    return this.buffer.slice(this.byteOffset, this.byteOffset + this.byteLength);
  };
  
  // ArrayBuffer extensions
  ArrayBuffer.prototype.toBuffer = function() {
    return Buffer.from(new Uint8Array(this));
  };
  
  // File type detection
  Uint8Array.prototype.getFileType = 
  ArrayBuffer.prototype.getFileType = 
  Buffer.prototype.getFileType = async function() {
    return await fileTypeFromBuffer(this);
  };
  
  // Number validation
  String.prototype.isNumber = 
  Number.prototype.isNumber = function() {
    const num = parseInt(this);
    return typeof num === "number" && !isNaN(num);
  };
  
  // String capitalization
  String.prototype.capitalize = function() {
    return this.charAt(0).toUpperCase() + this.slice(1);
  };
  
  String.prototype.capitalizeV2 = function() {
    return this.split(" ").map(word => word.capitalize()).join(" ");
  };
  
  // JID processing
  String.prototype.decodeJid = function() {
    if (/:\d+@/gi.test(this)) {
      const decoded = jidDecode(this) || {};
      return (decoded.user && decoded.server ? 
        `${decoded.user}@${decoded.server}` : 
        this).trim();
    }
    return this.trim();
  };
  
  // Time formatting
  Number.prototype.toTimeString = function() {
    const seconds = Math.floor(this / 1000 % 60);
    const minutes = Math.floor(this / 60000 % 60);
    const hours = Math.floor(this / 3600000 % 24);
    const days = Math.floor(this / 86400000);
    
    return [
      days ? `${days} day(s)` : '',
      hours ? `${hours} hour(s)` : '',
      minutes ? `${minutes} minute(s)` : '',
      seconds ? `${seconds} second(s)` : ''
    ].filter(Boolean).join(' ').trim();
  };
  
  // Random selection
  Number.prototype.getRandom = 
  String.prototype.getRandom = 
  Array.prototype.getRandom = function() {
    if (Array.isArray(this) || this instanceof String) {
      return this[Math.floor(Math.random() * this.length)];
    }
    return Math.floor(Math.random() * this);
  };
}

// Helper functions
function isNumber() {
  const num = parseInt(this);
  return typeof num === "number" && !isNaN(num);
}

function getRandom() {
  if (Array.isArray(this) || this instanceof String) {
    return this[Math.floor(Math.random() * this.length)];
  }
  return Math.floor(Math.random() * this);
}

function nullish(value) {
  return !(value !== null && value !== undefined);
}
