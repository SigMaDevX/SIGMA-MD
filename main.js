import './config.js';
import dotenv from 'dotenv';
import { createRequire } from 'module';
import path, { join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { platform } from 'process';
import 'ws';
import { readdirSync, statSync, unlinkSync, existsSync, readFileSync, watch } from 'fs';
import yargs from 'yargs';
import { spawn } from 'child_process';
import _ from 'lodash';
import chalk from 'chalk';
import syntaxError from 'syntax-error';
import { tmpdir } from 'os';
import { format } from 'util';
import { makeWASocket, protoType, serialize } from './lib/simple.js';
import { Low, JSONFile } from 'lowdb';
import pino from 'pino';
import cloudDBAdapter from './lib/cloudDBAdapter.js';
import { MongoDB } from './lib/mongoDB.js';
import { PostgresDB } from './lib/postgresDB.js';
import store from './lib/store.js';
import { Boom } from '@hapi/boom';
import 'moment-timezone';
import NodeCache from 'node-cache';
import readline from 'readline';
import fs from 'fs';
import SigmaSessionSavedCredentials from './lib/sigmasession.js';

const {
  DisconnectReason,
  useMultiFileAuthState,
  MessageRetryMap,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  makeInMemoryStore,
  proto,
  delay,
  jidNormalizedUser,
  PHONENUMBER_MCC,
  Browsers
} = await (await import("@whiskeysockets/baileys")).default;

dotenv.config();

async function main() {
  const sessionId = process.env.SESSION_ID;
  if (!sessionId) {
    console.error("SESSION_ID variable not found.");
    return;
  }
  try {
    await SigmaSessionSavedCredentials(sessionId);
    console.log("SigmaSessionSavedCredentials completed...✅");
  } catch (error) {
    console.error("Error:", error);
  }
}

main();
await delay(10000);

const { chain } = _;
const PORT = process.env.PORT || process.env.SERVER_PORT || 3000;

protoType();
serialize();

global.__filename = function filename(url = import.meta.url, isUnix = platform !== "win32") {
  return isUnix ? /file:\/\/\//.test(url) ? fileURLToPath(url) : url : pathToFileURL(url).toString();
};

global.__dirname = function dirname(path) {
  return path.dirname(global.__filename(path, true));
};

global.__require = function require(path = import.meta.url) {
  return createRequire(path);
};

global.API = (name, path = '/', query = {}, apikey) => (name in global.APIs ? global.APIs[name] : name) + path + (query || apikey ? '?' + new URLSearchParams(Object.entries({
  ...query,
  ...(apikey ? {
    [apikey]: global.APIKeys[name in global.APIs ? global.APIs[name] : name]
  } : {})
})) : '');

global.timestamp = {
  start: new Date()
};

const __dirname = global.__dirname(import.meta.url);
global.opts = new Object(yargs(process.argv.slice(2)).exitProcess(false).parse());
global.prefix = new RegExp('^[' + (process.env.PREFIX || "‎z/i!#$%+£¢€¥^°=¶∆×÷π√✓©®:;?&.,\\-").replace(/[|\\{}()[\]^$+*?.\-\^]/g, "\\$&") + ']');

global.opts.db = process.env.DATABASE_URL;
global.db = new Low(/https?:\/\//.test(opts.db || '') ? new cloudDBAdapter(opts.db) : /mongodb(\+srv)?:\/\//i.test(opts.db) ? new MongoDB(opts.db) : /postgresql:\/\/|postgres:\/\//i.test(opts.db) ? new PostgresDB(opts.db) : new JSONFile((opts._[0] ? opts._[0] + '_' : '') + 'database.json'));

global.DATABASE = global.db;

global.loadDatabase = async function loadDatabase() {
  if (global.db.READ) {
    return new Promise(resolve => setInterval(async function() {
      if (!global.db.READ) {
        clearInterval(this);
        resolve(global.db.data == null ? global.loadDatabase() : global.db.data);
      }
    }, 1000));
  }
  if (global.db.data !== null) return;
  
  global.db.READ = true;
  await global.db.read().catch(console.error);
  global.db.READ = null;
  global.db.data = {
    users: {},
    chats: {},
    stats: {},
    msgs: {},
    sticker: {},
    settings: {},
    ...(global.db.data || {})
  };
  global.db.chain = chain(global.db.data);
};

loadDatabase();

global.authFile = 'sessions';
const { state, saveState, saveCreds } = await useMultiFileAuthState(global.authFile);

const cacheOptions = {
  stdTTL: 0,
  checkperiod: 0
};

const msgRetryCounterCache = new NodeCache(cacheOptions);
const userDevicesCache = new NodeCache(cacheOptions);

let phoneNumber = global.botNumber[0];
const methodCodeQR = process.argv.includes('qr');
const methodCode = !!phoneNumber || process.argv.includes("code");
const MethodMobile = process.argv.includes("mobile");

const rlOptions = {
  input: process.stdin,
  output: process.stdout
};

const rl = readline.createInterface(rlOptions);
const question = (text) => new Promise(resolve => rl.question(text, resolve));

let opcion;
if (methodCodeQR) {
  opcion = '1';
}

if (!methodCodeQR && !methodCode && !fs.existsSync('./' + authFile + '/creds.json')) {
  do {
    opcion = await question("\n\n\n✳️ Enter the connection method\n\n\n🔺 1 : per QR code\n🔺 2 : per 8-digit CODE\n\n\n\n");
    if (!/^[1-2]$/.test(opcion)) {
      console.log("\n\n🔴 Enter only one option \n\n 1 o 2\n\n");
    }
  } while (opcion !== '1' && opcion !== '2' || fs.existsSync('./' + authFile + "/creds.json"));
}

console.info = () => {};

const loggerOptions = {
  level: "silent"
};

const connectionOptions = {
  logger: pino(loggerOptions),
  printQRInTerminal: opcion === '1' || methodCodeQR,
  mobile: MethodMobile,
  browser: opcion === '1' ? ["Sigma", "Safari", '2.0.0'] : methodCodeQR ? ["Sigma", "Safari", "2.0.0"] : ['Ubuntu', 'Chrome', "20.0.04"],
  auth: {
    creds: state.creds,
    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' }).child({ level: 'fatal' }))
  },
  waWebSocketUrl: 'wss://web.whatsapp.com/ws/chat?ED=CAIICA',
  markOnlineOnConnect: true,
  generateHighQualityLinkPreview: true,
  getMessage: async (key) => {
    let jid = jidNormalizedUser(key.remoteJid);
    let msg = await store.loadMessage(jid, key.id);
    return msg?.message || '';
  },
  patchMessageBeforeSending: async (message) => {
    let requiresPreKey = 0;
    global.conn.uploadPreKeysToServerIfRequired();
    requiresPreKey++;
    return message;
  },
  msgRetryCounterCache: msgRetryCounterCache,
  userDevicesCache: userDevicesCache,
  defaultQueryTimeoutMs: undefined,
  cachedGroupMetadata: (jid) => global.conn.chats[jid] ?? {},
  version: [2, 3000, 1015901307]
};

global.conn = makeWASocket(connectionOptions);

if (!fs.existsSync('./' + authFile + "/creds.json")) {
  if (opcion === '2' || methodCode) {
    opcion = '2';
    if (!conn.authState.creds.registered) {
      if (MethodMobile) {
        throw new Error("⚠️ Mobile API Error Occurred");
      }
      let addNumber;
      if (!!phoneNumber) {
        addNumber = phoneNumber.replace(/[^0-9]/g, '');
        if (!Object.keys(PHONENUMBER_MCC).some(country => addNumber.startsWith(country))) {
          console.log(chalk.bgBlack(chalk.bold.redBright("\n\n✴️ Your number must start with the country code")));
          process.exit(0);
        }
      } else {
        while (true) {
          addNumber = await question(chalk.bgBlack(chalk.bold.greenBright("\n\n✳️ Enter your number\n\nExample: 923427xxxx\n\n")));
          addNumber = addNumber.replace(/[^0-9]/g, '');
          if (addNumber.match(/^\d+$/) && Object.keys(PHONENUMBER_MCC).some(country => addNumber.startsWith(country))) {
            break;
          } else {
            console.log(chalk.bgBlack(chalk.bold.redBright("\n\n✴️ Make sure to add the country code")));
          }
        }
        rl.close();
      }
      setTimeout(async () => {
        let code = await conn.requestPairingCode(addNumber);
        code = code?.match(/.{1,4}/g)?.join('-') || code;
        console.log(chalk.yellow("\n\n🍏 enter the code in WhatsApp."));
        console.log(chalk.black(chalk.bgGreen("\n🔴  Its Code is: ")), chalk.black(chalk.red(code)));
      }, 3000);
    }
  }
}

conn.isInit = false;

if (!opts.test) {
  setInterval(async () => {
    if (global.db.data) {
      await global.db.write().catch(console.error);
    }
    if (opts.autocleartmp) {
      try {
        clearTmp();
      } catch (error) {
        console.error(error);
      }
    }
  }, 60000);
}

if (opts.server) {
  (await import("./server.js")).default(global.conn, PORT);
}

async function clearTmp() {
  const tmpDirs = [tmpdir(), join(__dirname, './tmp')];
  const files = [];
  tmpDirs.forEach(dir => readdirSync(dir).forEach(file => files.push(join(dir, file))));
  return files.map(file => {
    const stats = statSync(file);
    if (stats.isFile() && Date.now() - stats.mtimeMs >= 60000) {
      return unlinkSync(file);
    }
    return false;
  });
}

setInterval(async () => {
  await clearTmp();
}, 60000);

global.botlive = process.env.MODE;

async function connectionUpdate(update) {
  const { connection, lastDisconnect, isNewLogin } = update;
  if (isNewLogin) {
    conn.isInit = true;
  }
  const statusCode = lastDisconnect?.error?.output?.statusCode || lastDisconnect?.error?.output?.payload?.statusCode;
  
  if (statusCode && statusCode !== DisconnectReason.loggedOut && conn?.ws?.socket == null) {
    console.log(await global.reloadHandler(true).catch(console.error));
    global.timestamp.connect = new Date();
  }
  
  if (global.db.data == null) {
    loadDatabase();
  }
  
if (connection === 'open') {
    const { jid, name } = conn.user;
    let StartMsg = "*✅ SIGMA-MD CONNECTED SUCCESSFULLY*\n\n" +
                    "*╭────◇ SIGMA-MD ◇─────╮*\n" +
                    "*├◈ Hello there SIGMA-MD User! 👋🏻*\n" +
                    "*├◈ PREFIX :* [ " + prefix + " ]\n" +
                    "*├◈ MODE :* " + botlive + "\n" +
                    "*├◈ Official Channel :* https://whatsapp.com/channel/0029Vb5WgwB8V0tnVsqSmC2N\n" +
                    "*├◈ GitHub Repo :* https://github.com/SigmaByteXD/SIGMA-MD\n" +
                    "*├◈ Note :* Don't forget to ⭐ the repo!\n" +
                    "*╰─────────────────────╯*\n" +
                    "> © Powered by SigmaByteXD 🖤";
    
    const options = {
      quoted: null
    };

    await conn.sendMessage(jid, {
      image: { url: "https://files.catbox.moe/dm39k4.jpg" }, 
      caption: StartMsg,
      mentions: [jid]
    }, options);

    console.log(chalk.bold.greenBright("🔴 Successfully connected to WhatsApp ✅"));
}

let reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
if (reason == 405) {
    await fs.unlinkSync("./sessions/creds.json");
    console.log(chalk.bold.redBright("[ ⚠ ] Connection replaced, Please wait a moment I'm going to restart...\nIf error appears start again with : npm start"));
    process.send("reset");
} 
    
  if (connection === "close") {
    if (reason === DisconnectReason.badSession) {
      conn.logger.error("[ ⚠ ] session error please change the session by " + global.authFile + " pairing again.");
    } else if (reason === DisconnectReason.connectionClosed) {
      conn.logger.warn("[ ⚠ ] Closed connection, reconnecting...");
      await global.reloadHandler(true).catch(console.error);
    } else if (reason === DisconnectReason.connectionLost) {
      conn.logger.warn("[ ⚠ ] Lost connection to the server, reconnecting...");
      await global.reloadHandler(true).catch(console.error);
    } else if (reason === DisconnectReason.connectionReplaced) {
      conn.logger.error("[ ⚠ ] Connection replaced, another new session has been opened. Please log out first.");
    } else if (reason === DisconnectReason.loggedOut) {
      conn.logger.error("[ ⚠ ] Closed connection, Please change the session " + global.authFile + " use sigma pair site or .getpair command get a new session.");
    } else if (reason === DisconnectReason.restartRequired) {
      conn.logger.info("[ ⚠ ] Restart required, restart the server if you have any problems.");
      await global.reloadHandler(true).catch(console.error);
    } else if (reason === DisconnectReason.timedOut) {
      conn.logger.warn("[ ⚠ ] Connection time, reconnecting...");
      await global.reloadHandler(true).catch(console.error);
    } else {
      conn.logger.warn("[ ⚠ ] Unknown disconnect reason. " + (reason || '') + ": " + (connection || ''));
      await global.reloadHandler(true).catch(console.error);
    }
  }
}

process.on("uncaughtException", console.error);

let isInit = true;
let handler = await import('./handler.js');

global.reloadHandler = async function (reset) {
  try {
    const newHandler = await import('./handler.js?update=' + Date.now()).catch(console.error);
    if (Object.keys(newHandler || {}).length) {
      handler = newHandler;
    }
  } catch (error) {
    console.error(error);
  }
  
  if (reset) {
    const oldChats = global.conn.chats;
    try {
      global.conn.ws.close();
    } catch {}
    conn.ev.removeAllListeners();
    const newConn = {
      chats: oldChats
    };
    global.conn = makeWASocket(connectionOptions, newConn);
    isInit = true;
  }
  
  if (!isInit) {
    conn.ev.off('messages.upsert', conn.handler);
    conn.ev.off('group-participants.update', conn.participantsUpdate);
    conn.ev.off('groups.update', conn.groupsUpdate);
    conn.ev.off("message.delete", conn.onDelete);
    conn.ev.off('connection.update', conn.connectionUpdate);
    conn.ev.off("creds.update", conn.credsUpdate);
  }
  
  conn.welcome = "Hello @user\nWelcome to @group";
  conn.bye = "Goodbye @user";
  conn.spromote = "@user Now he is an administrator";
  conn.sdemote = "@user he is no longer an administrator";
  conn.sDesc = "The description has been changed to \n@desc";
  conn.sSubject = "The name of the group has been changed to \n@group";
  conn.sIcon = "The group icon has been changed";
  conn.sRevoke = "The group link has been changed to \n@revoke";
  
  conn.handler = handler.handler.bind(global.conn);
  conn.participantsUpdate = handler.participantsUpdate.bind(global.conn);
  conn.groupsUpdate = handler.groupsUpdate.bind(global.conn);
  conn.onDelete = handler.deleteUpdate.bind(global.conn);
  conn.connectionUpdate = connectionUpdate.bind(global.conn);
  conn.credsUpdate = saveCreds.bind(global.conn, true);
  
  conn.ev.on("messages.upsert", conn.handler);
  conn.ev.on('group-participants.update', conn.participantsUpdate);
  conn.ev.on('groups.update', conn.groupsUpdate);
  conn.ev.on("message.delete", conn.onDelete);
  conn.ev.on('connection.update', conn.connectionUpdate);
  conn.ev.on("creds.update", conn.credsUpdate);
  
  isInit = false;
  return true;
};

const pluginFolder = global.__dirname(join(__dirname, "./plugins/index"));
const pluginFilter = filename => /\.js$/.test(filename);
global.plugins = {};

async function filesInit() {
  for (let filename of readdirSync(pluginFolder).filter(pluginFilter)) {
    try {
      let filePath = global.__filename(join(pluginFolder, filename));
      const plugin = await import(filePath);
      global.plugins[filename] = plugin.default || plugin;
    } catch (error) {
      conn.logger.error(error);
      delete global.plugins[filename];
    }
  }
}

filesInit().then(result => console.log(Object.keys(global.plugins))).catch(console.error);

global.reload = async (reset, filename) => {
  if (/\.js$/.test(filename)) {
    let filepath = global.__filename(join(pluginFolder, filename), true);
    if (filename in global.plugins) {
      if (existsSync(filepath)) {
        conn.logger.info("🌟 Updated Plugin - '" + filename + "'");
      } else {
        conn.logger.warn("🗑️ Plugin Removed - '" + filename + "'");
        return delete global.plugins[filename];
      }
    } else {
      conn.logger.info("✨ New plugin - '" + filename + "'");
    }
    
    const parserOptions = {
      sourceType: "module",
      allowAwaitOutsideFunction: true
    };
    
    let syntaxErr = syntaxError(readFileSync(filepath), filename, parserOptions);
    if (syntaxErr) {
      conn.logger.error("syntax error while loading '" + filename + "'\n" + format(syntaxErr));
    } else {
      try {
        const plugin = await import(global.__filename(filepath) + '?update=' + Date.now());
        global.plugins[filename] = plugin.default || plugin;
      } catch (error) {
        conn.logger.error("error require plugin '" + filename + "\n" + format(error) + "'");
      } finally {
        global.plugins = Object.fromEntries(Object.entries(global.plugins).sort(([a], [b]) => a.localeCompare(b)));
      }
    }
  }
};

Object.freeze(global.reload);
watch(pluginFolder, global.reload);
await global.reloadHandler();

async function _quickTest() {
  let tests = await Promise.all([
    spawn('ffmpeg'),
    spawn("ffprobe"),
    spawn('ffmpeg', ['-hide_banner', "-loglevel", "error", "-filter_complex", "color", "-frames:v", '1', '-f', "webp", '-']),
    spawn('convert'),
    spawn("magick"),
    spawn('gm'),
    spawn("find", ["--version"])
  ].map(cmd => {
    return Promise.race([
      new Promise(resolve => {
        cmd.on("close", code => {
          resolve(code !== 127);
        });
      }),
      new Promise(resolve => {
        cmd.on("error", error => resolve(false));
      })
    ]);
  }));
  
  let [ffmpeg, ffprobe, ffmpegWebp, convert, magick, gm, find] = tests;
  console.log(tests);
  
  const support = {
    ffmpeg,
    ffprobe,
    ffmpegWebp,
    convert,
    magick,
    gm,
    find
  };
  
  let globalSupport = global.support = support;
  Object.freeze(global.support);
  
  if (!globalSupport.ffmpeg) {
    conn.logger.warn("Please install ffmpeg for sending videos (pkg install ffmpeg)");
  }
  
  if (globalSupport.ffmpeg && !globalSupport.ffmpegWebp) {
    conn.logger.warn("Stickers may not animated without libwebp on ffmpeg (--enable-ibwebp while compiling ffmpeg)");
  }
  
  if (!globalSupport.convert && !globalSupport.magick && !globalSupport.gm) {
    conn.logger.warn("Stickers may not work without imagemagick if libwebp on ffmpeg doesnt isntalled (pkg install imagemagick)");
  }
}

_quickTest().then(() => conn.logger.info("✅BOT MAIN FILE LOADED")).catch(console.error);
