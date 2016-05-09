This plugin allows AKP48Squared to receive GitHub Webhooks and automatically update.

# Installation

This plugin is included by default on new installations of AKP48Squared. No further installation is needed.

# Config

github-listener will create a default configuration when it first starts up. After that, you can edit the configuration in AKP48Squared's `config.json` file. You will need to set up your repo/repos or organization webhooks to send to `http://[your_server]:[config_port]/github/callback`, where `[your_server]` is the IP address or hostname to your server, and `[config_port]` is the port set for github-listener in `config.json`.

# Issues

If you come across any issues, you can report them on this GitHub repo [here](https://github.com/AKP48Squared/akp48-plugin-github-listener/issues).
