# Replay transactions
This plugin helps you replaying transactions easily from one chain to another.  

Currently only transfer transactions are supported.

## Installation
Use these steps if you installed your node using Git clone.

1. Go to the plugin directory `cd ~/solar-core/plugins`.
2. Clone the plugin `git clone https://github.com/e-m-s-y/replay-transactions -b solar`.
3. Install and build the plugin `cd replay-transactions && pnpm install && pnpm build`.
4. Customize the plugin configuration to your needs.
5. Add the configuration to `~/.config/solar-core/{mainnet|testnet}/app.json` at the bottom of relay.plugins and / or core.plugins.
6. Restart your relay and / or core process(es).

Note: plugin starts immediately after the blockchain has initialized.

#### Plugin configuration example
```js
{
    "package": "@foly/replay-transactions",
        "options": {
        "enabled": true,
            "url": "https://api.radians.nl/api/v2/transactions/search",
            "coreVersionChild": 2,
            "query": {},
            "pageLimit": 100,
            "batches": [
            {
                "senderIdChild": "TCk7apWTVEjmRkEDfYeQvde5aTNfdmnSjX",
                "mnemonicParent": ""
            }
        ]
    }
}
```
#### Configuration options
```
enabled - flag to turn the plugin on or off
url - full URL of API endpoint, used for reading transactions
query - query parameters used to search for transactions, check Query interface for more details
pageLimit - pagination limit of the API (default 100)
coreVersionChild - core version of the API (2 or 3)
batches - array with senderId used for searching API plus a mnemonic of the new senderId on new chain
``` 

Plugin uses transaction pool configuration to automatically chunk the transactions, default chunk size is 150.

## Credits

- [e-m-s-y](https://github.com/e-m-s-y)

## License

[LICENSE](LICENSE.md)
