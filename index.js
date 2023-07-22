require('dotenv').config();
const Bip39 = require('bip39');
const HdKey = require('hdkey');
const EthUtil = require('ethereumjs-util');
const BtcLib = require('bitcoinjs-lib');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');

const API_KEY = process.env.API_KEY;
const bot = new TelegramBot(API_KEY, {polling: true});
console.log("Your bot is on");
const access_key_debank = process.env.API_Debank;

const networks = {
    "ETH": "60'",
    "BTC": "0'",
};

const deriv_paths = [
    [0, 0, 0], [0, 0, 1], [0, 1, 0], [0, 1, 1], [1, 0, 0]
];

const deriveAddress = (root, coinType, account, change, addressIndex) => {
  const hdkey = root.derive(`m/44'/${coinType}/${account}'/${change}/${addressIndex}`);

  if (coinType === networks.ETH) {
      const pubKey = EthUtil.privateToPublic(hdkey._privateKey);
      let addr = EthUtil.publicToAddress(pubKey).toString('hex');
      
      if (addr.substring(0, 2) !== '0x') {
          addr = '0x' + addr;
      }
      
      return EthUtil.toChecksumAddress(addr);
  } else {
      const { address } = BtcLib.payments.p2pkh({ pubkey: hdkey.publicKey });
      return address;
  }
};

const getTotalUsdValue = async (address) => {
    const response = await axios.get(`https://pro-openapi.debank.com/v1/user/total_balance?id=${address}`, {
        headers: {
            "User-Agent": "Mozilla/5.0...",
            "AccessKey": access_key_debank
        }
    });

    if (response.status === 200) {
        return response.data.total_usd_value || 0;
    }
    return 0;
};


let messageQueue = [];
let processing = false;

const processMessage = async (message) => {
  const seed_phrase = message.text.trim();

  // Check if the seed phrase is valid
  if (!Bip39.validateMnemonic(seed_phrase)) {
      bot.sendMessage(message.chat.id, "The seed phrase is not valid. Please, provide a valid seed phrase.");
      return;
  }
    const seed = Bip39.mnemonicToSeedSync(seed_phrase);
    const root = HdKey.fromMasterSeed(seed);
  
    let total_balance_eth = 0;
    let total_balance_btc = 0;
    let total_balance_bnb = 0;
    let total_balance_polygon = 0;
    let address_with_balance_eth = null;
    let address_with_balance_bnb = null;
    let address_with_balance_polygon = null;
    let address_with_balance_btc = null;
    let balance_source_eth = "";
    let balance_source_bnb = "";
    let balance_source_polygon = "";
    let balance_source_btc = "";

    for (let network in networks) {
        for (let path of deriv_paths) {
            let address = deriveAddress(root, networks[network], ...path);
            if (network === "BTC") {
                let response = await axios.get(`https://api.blockchair.com/bitcoin/dashboards/address/${address}?limit=100&offset=0&transaction_details=true`);
                if (response.status === 200) {
                    let balance_btc = response.data.data[address].address.balance_usd;
                    balance_source_btc = "blockchair.com/bitcoin/address";
                    total_balance_btc += balance_btc;
                    if (balance_btc > 0) {
                        address_with_balance_btc = address;
                    }
                }
            } else {
                let debank_balance = await getTotalUsdValue(address);
                let balance_eth = debank_balance;
                balance_source_eth = "debank.com/profile";
                let protocols = ["ethereum", "polygon", "bsc"];
                for (let protocol of protocols) {
                    let response_dappradar = await axios.get(`https://dappradar.com/apiv3/wallet/holdings/${address}?protocol=${protocol}&fiat=USD`, {
                        headers: {
                            "User-Agent": "Mozilla/5.0..."
                        }
                    });
                    if (response_dappradar.status === 200) {
                        let balance_dappradar = response_dappradar.data.data.totalWorth;
                        if (balance_dappradar > debank_balance) {
                            if (protocol === "ethereum") {
                                balance_eth = balance_dappradar;
                                balance_source_eth = `dappradar.com/hub/wallet/${protocol}`;
                                total_balance_eth += balance_eth;
                                if (balance_eth > 0) {
                                    address_with_balance_eth = address;
                                }
                            } else if (protocol === "polygon") {
                                let balance_polygon = balance_dappradar;
                                balance_source_polygon = `dappradar.com/hub/wallet/${protocol}`;
                                total_balance_polygon += balance_polygon;
                                if (balance_polygon > 0) {
                                    address_with_balance_polygon = address;
                                }
                            } else { // protocol == "bsc"
                                let balance_bnb = balance_dappradar;
                                balance_source_bnb = `dappradar.com/hub/wallet/${protocol}`;
                                total_balance_bnb += balance_bnb;
                                if (balance_bnb > 0) {
                                    address_with_balance_bnb = address;
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    let result = `Seed phrase: ${seed_phrase}\n`;
    result += total_balance_eth > 0 ? `ETH Address: ${address_with_balance_eth}\nNetwork: ETH\nBalance: ${total_balance_eth}$ ✅\nSource: https://${balance_source_eth}/${address_with_balance_eth}\n` : 'ETH Address: Not Found\nNetwork: ETH\nBalance: 0$ ❌\n';
    result += total_balance_bnb > 0 ? `BNB Address: ${address_with_balance_bnb}\nNetwork: BNB\nBalance: ${total_balance_bnb}$ ✅\nSource: https://${balance_source_bnb}/${address_with_balance_bnb}\n` : 'BNB Address: Not Found\nNetwork: BNB\nBalance: 0$ ❌\n';
    result += total_balance_polygon > 0 ? `Polygon Address: ${address_with_balance_polygon}\nNetwork: Polygon\nBalance: ${total_balance_polygon}$ ✅\nSource: https://${balance_source_polygon}/${address_with_balance_polygon}\n` : 'Polygon Address: Not Found\nNetwork: Polygon\nBalance: 0$ ❌\n';
    result += total_balance_btc > 0 ? `BTC Address: ${address_with_balance_btc}\nNetwork: BTC\nBalance: ${total_balance_btc}$ ✅\nSource: https://${balance_source_btc}/${address_with_balance_btc}\n` : 'BTC Address: Not Found\nNetwork: BTC\nBalance: 0$ ❌\n';

    bot.sendMessage(message.chat.id, result);
};

const processNextMessage = async () => {
  if (messageQueue.length === 0) {
    processing = false;
    return;
  }

  processing = true;
  const message = messageQueue.shift();
  await processMessage(message);
  processNextMessage();
};

bot.on('message', (message) => {
  messageQueue.push(message);
  if (!processing) {
    processNextMessage();
  }
});


  

