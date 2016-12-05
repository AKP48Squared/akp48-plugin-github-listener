'use strict';
const getRepoInfo = require('git-repo-info');
const GitHubHook = require('githubhook');
const glob = require('glob');
const path = require('path');
const Promise = require('bluebird'); //jshint ignore:line
const shell = require('shelljs');

var defaultConfig = {
  port: 4269,
  path: '/github/callback',
  secret: '',
  repository: 'AKP48Squared',
  branch: 'master',
  autoUpdate: false,
  events: {
    push: true,
    commit_comment: true,
    pull_request: true,
    issues: true,
    issue_comment: true,
    gollum: true,
    fork: true,
    watch: true,
    repository: true
  },
  enabled: true
};

class GitHubListener extends global.AKP48.pluginTypes.Generic {
  constructor(AKP48) {
    super(AKP48, 'GitHubListener');
  }

  load() {
    if(Object.keys(this._config).length === 0 && this._config.constructor === Object) {
      global.logger.info(`${this.name}: No config specified. Saving defaults.`);

      AKP48.saveConfig(defaultConfig, 'github-listener');
      this._config = defaultConfig;
    }

    this._isRepo = (getRepoInfo._findRepo('.') !== null);

    if(this.config.enabled) {
      this._listener = new GitHubHook({
        path: this.config.path,
        port: this.config.port,
        secret: this.config.secret,
        logger: { //define a logger object, so the module doesn't just use console directly.
          log: function(msg){
            global.logger.silly(`${self.name}|GitHubHook: ${msg}`);
          },
          error: function(msg){
            global.logger.error(`${self.name}|GitHubHook: ${msg}`);
          }
        }
      });

      global.logger.info(`${this.name}: Listening for Webhooks from GitHub.`);
      global.logger.debug(`${this.name}: Listening at ${this.config.path} on ${this.config.port}.`);
      global.logger.silly(`${this.name}: Listening for repo ${this.config.repository}, branch ${this.config.branch}.`);

      this._listener.listen();

      var self = this;
      this._listener.on(`push`, function (repo, ref, data) {
        if(data.deleted) {
          return;
        }
        global.logger.silly(`${self.name}: Received Webhook: ref => ${ref}.`);

        var branch = ref.substring(ref.indexOf('/', 5) + 1);

        //send out alert.
        var commits = `${data.commits.length} commit`.pluralize(data.commits.length);
        var url = data.compare;

        var msg = [];
        msg.push({style: 'pink', text: '[Github] '});
        msg.push({style: 'green', text: `[${repo}] `});
        msg.push(`${commits} ${data.forced && !data.created ? 'force ' : ''}pushed to ${data.created ? 'new ' : ''}`);
        msg.push(`${data.ref.startsWith('refs/tags/') ? 'tag' : 'branch'} `);
        msg.push({style: 'bold', text: `${branch} `});
        msg.push(`by ${data.pusher.name}. `);
        msg.push(`(${url})`);

        for (var i = 0; i < data.commits.length && i < 3; i++) {
          var _c = data.commits[data.commits.length - 1 - i];
          var _m = _c.message;
          var end = _m.indexOf('\n');
          msg.push({style: 'green', text: `[${_c.id.substring(0,7)}] `});
          msg.push(`${_c.author.username}: ${_m.substring(0, end === -1 ? _m.length : end)}`);
        }

        if(self.shouldSendAlert('push')) {
          global.logger.verbose(`${self.name}: Sending alert.`);
          AKP48.sendAlert(msg);
        }

        if(self.shouldUpdate(branch) && repo === self._config.repository) {
          self.handle(branch, data);
        }

      }).on(`pull_request`, function(repo, ref, data) {
        if(!self.shouldSendAlert('pull_request')) { return; }
        if(data.action === 'closed' && data.pull_request.merged) {
          data.action = 'merged';
        }
        if(data.pull_request.title.length >= 80) {
          data.pull_request.title = data.pull_request.title.substring(0,80) + '...';
        }

        var out = [];
        out.push({style: 'pink', text: '[Github] '});
        out.push({style: 'green', text: `[${repo}] `});
        out.push(`Pull Request ${data.number} ${data.action}. Title: ${data.pull_request.title}`);
        AKP48.sendAlert(out);
      }).on(`issues`, function(repo, ref, data) {
        if(!self.shouldSendAlert('issues')) { return; }
        if(data.issue.title.length >= 80) {
          data.issue.title = data.issue.title.substring(0,80) + '...';
        }
        if(data.action === 'assigned' || data.action === 'unassigned') {
          data.action += ` ${data.action === 'unassigned' ? 'from' : 'to'} ${data.assignee.login}`;
        }

        if(data.action === 'labeled' || data.action === 'unlabeled') {
          data.action += ` ${data.label.name}`;
        }
        var out = [];
        out.push({style: 'pink', text: '[Github] '});
        out.push({style: 'green', text: `[${repo}] `});
        out.push(`Issue ${data.issue.number} ${data.action}. Title: ${data.issue.title}`);
        AKP48.sendAlert(out);
      }).on(`issue_comment`, function(repo, ref, data) {
        if(!self.shouldSendAlert('issue_comment')) { return; }
        if(data.comment.body.length >= 80) {
          data.comment.body = data.comment.body.substring(0,80) + '...';
        }
        var out = [];
        out.push({style: 'pink', text: '[Github] '});
        out.push({style: 'green', text: `[${repo}] `});
        out.push(`New comment on issue ${data.issue.number} by `);
        out.push({style: bold, text: `${data.comment.user.login}. `});
        out.push(`${data.comment.body} (${data.comment.html_url})`);
        AKP48.sendAlert(out);
      }).on(`gollum`, function(repo, ref, data) {
        if(!self.shouldSendAlert('gollum')) { return; }
        for (var i = 0; i < data.pages.length; i++) {
          var pg = data.pages[i];
          var out = [];
          out.push({style: 'pink', text: '[Github] '});
          out.push({style: 'green', text: `[${repo}] `});
          out.push(`Wiki Page`);
          out.push({style: bold, text: `${pg.page_name} `});
          out.push(`${pg.action}. (${pg.html_url})`);
          AKP48.sendAlert(out);
        }
      }).on(`fork`, function(repo, ref, data) {
        if(!self.shouldSendAlert('fork')) { return; }
        var out = [];
        out.push({style: 'pink', text: '[Github] '});
        out.push({style: 'green', text: `[${repo}] `});
        out.push(`New Fork!`);
        out.push({style: bold, text: `${data.sender.login} `});
        out.push(`forked the repo! (${data.forkee.html_url})`);
        AKP48.sendAlert(out);
      }).on(`watch`, function(repo, ref, data) {
        if(!self.shouldSendAlert('watch')) { return; }
        var out = [];
        out.push({style: 'pink', text: '[Github] '});
        out.push({style: 'green', text: `[${repo}] `});
        out.push(`New Star!`);
        out.push({style: bold, text: `${data.sender.login} `});
        out.push(`starred the repo!`);
        AKP48.sendAlert(out);
      }).on(`repository`, function(repo, ref, data) {
        if(!self.shouldSendAlert('watch')) { return; }
        var out = [];
        out.push({style: 'pink', text: '[Github] '});
        out.push({style: 'green', text: `[${data.organization.login} Organization] `});
        out.push(`Repository `);
        out.push({style: 'bold', text: `${data.repository.name} `});
        out.push(`${data.action} by `);
        out.push({style: 'bold', text: `${data.sender.login}`});
        out.push(`. (${data.repository.html_url})`);
        AKP48.sendAlert(out);
      }).on('commit_comment', function (repo, ref, data) {
        if (!self.shouldSendAlert('commit_comment')) { return; }
        var out = [];
        out.push({style: 'pink', text: '[Github] '});
        out.push({style: 'green', text: `[${repo}] `});
        out.push(`${data.comment.user.login} left a comment. ${data.comment.html_url}`);
        AKP48.sendAlert(out);
      });
    }
  }
}

GitHubListener.prototype.compare = function (original, other) {
  if (other === '*' || original === other) { // Checking here saves pain and effort
      return true;
  } else if (other.startsWith('!') || other.startsWith('-')) { // We should update to all except the specified
      // Should we do a compare?
      //return !compare(original, other.substring(1));
      return original !== other.substring(1);
  }

  var star = other.indexOf('*'), star2 = other.lastIndexOf('*');
  if (star !== -1) {
      if (star2 > star) {
          return original.contains(other.substring(star + 1, star2 - 1));
      }
      if (star === 0) {
          return original.endsWith(other.substring(star + 1));
      } else {
          return original.startsWith(other.substring(star - 1));
      }
  }

  return false;
};

GitHubListener.prototype.shouldUpdate = function (branch) {
  var updateBranch = this.config.branch;
  if (Array.isArray(updateBranch)) { // We update only if it is listed
      for (var x = 0; x < updateBranch.length; x++) {
          var _branch = updateBranch[x];
          if (this.compare(branch, _branch)) {
              return true;
          }
      }
      return false;
  }

  return this.compare(branch, updateBranch);
};

GitHubListener.prototype.handle = function (branch, data) {
  var self = this;
  global.logger.info(`${this.name}: Handling Webhook for branch ${branch}.`);

  if (!shell.which('git') || !this._isRepo) {
    global.logger.debug(`${this.name}: Not a git repo; stopping update.`);
    return;
  }

  var changing_branch = branch !== this.getBranch();
  var update = this.config.autoUpdate && (data.commits.length !== 0 || changing_branch);

  global.logger.silly(`${this.name}: Is changing branch? ${changing_branch}.`);
  global.logger.silly(`${this.name}: Is updating? ${update}.`);

  if (!update) {
    global.logger.debug(`${this.name}: Nothing to update; stopping update.`);
    return;
  }

  var shutdown = changing_branch;
  var npm = changing_branch;
  var hot_files = ['app.js'];

  if (!shutdown) {

    for (var commit in data.commits) {
      if (data.commits.hasOwnProperty(commit)) {
        var com = data.commits[commit];
        for (var file in com.modified) {
          if (com.modified.hasOwnProperty(file)) {
            if(hot_files.indexOf(com.modified[file]) !== -1) {
              shutdown = true;
            }
            if(com.modified[file].includes('package.json')) {
              npm = true;
            }
          }
        }

        for (var f in com.created) {
          if (com.modified.hasOwnProperty(f)) {
            if(com.modified[f].includes('package.json')) {
              npm = true;
            }
          }
        }
      }
    }
  }

  global.logger.debug(`${this.name}: Updating to branch "${branch}".`);

  // Fetch, Checkout
  if (!this.checkout(branch)) {
    return;
  }

  if(npm) {
    global.logger.debug(`${this.name}: Executing npm install.`);
    shell.cd(require('app-root-path').path);
    shell.exec('npm install');
  }

  var pluginPath = path.resolve(require('app-root-path').path, 'plugins/*/plugin.json');
  glob(pluginPath, function(err, files) {
    if(err) {global.logger.error(`${this.name}: Glob error: "${err}".`);return;}

    new Promise(function(resolve) {
      //two separate loops because shell is doing something weird if I do it all as one loop.
      //first loop resolves paths to full absolute paths.
      for (var i = 0; i < files.length; i++) {
        files[i] = path.dirname(path.resolve(files[i]));
      }

      var proms = [];

      //second loop CDs into each directory and runs npm install.
      for (var j = 0; j < files.length; j++) {
        shell.cd(files[j]);

        proms.push(new Promise(function(resolve){ // jshint ignore:line
          if(npm) {
            global.logger.verbose(`${self.name}: Executing npm install for ${files[j]}.`);
            shell.exec('npm install', function(){
              resolve();
            });
          } else {
            resolve();
          }
        }));
      }

      Promise.all(proms).then(function(){
        resolve(); //resolve promise after all npm installs are finished.
      });

    }).then(function(){
      if (shutdown) {
        self._AKP48.shutdown(`I'm updating! :3`);
      } else {
        self._AKP48.reload();
      }
    });
  });
};

GitHubListener.prototype.fetch = function () {
  if(shell.exec('git fetch').code) {
    global.logger.error(`${this.name}: Attempted git fetch failed!`);
    return;
  } else {
    global.logger.verbose(`${this.name}: Fetched latest code from git.`);
  }
  return true;
};

GitHubListener.prototype.getCommit = function () {
  return getRepoInfo().sha;
};

GitHubListener.prototype.getBranch = function () {
  return getRepoInfo().branch;
};

GitHubListener.prototype.getTag = function () {
  return getRepoInfo().tag;
};

GitHubListener.prototype.checkout = function (branch) {
  if (!branch || !this.fetch()) {
    return;
  }
  if (this.getBranch() !== branch) {
    if (shell.exec(`git checkout -q ${branch}`).code) {
      global.logger.error(`${this.name}: Attempted git reset failed!`);
      return;
    } else {
      global.logger.verbose(`${this.name}: Successfully checked out branch "${branch}".`);
    }
  }
  if ((this.getBranch() || this.getTag()) && shell.exec(`git reset -q origin/${branch} --hard`).code) {
    global.logger.error(`${this.name}: Attempted git reset failed!`);
    return;
  } else {
    global.logger.verbose(`${this.name}: Successfully reset to branch "${branch}".`);
  }
  return true;
};

GitHubListener.prototype.shouldSendAlert = function (hookType) {
  if(!this.config.events || !this.config.events.hasOwnProperty('commit_comment')) { // legacy config didn't have events object.
    this.config.events = this.config.events || defaultConfig.events;
    if (!this.config.events.hasOwnProperty('commit_comment')) { this.config.events.commit_comment = true; }
    this._AKP48.saveConfig(this.config, 'github-listener');
    return true;
  }

  if(this.config.events[hookType]) {return true;} // hookType is enabled in config.
  return false;
};

//called when we are told we're unloading.
GitHubListener.prototype.unload = function () {
  var self = this;
  return new Promise(function (resolve) {
    if(self._listener) {
      self._listener.stop();
      delete self._listener;
    }
    resolve();
  });
};

module.exports = GitHubListener;
module.exports.type = 'BackgroundTask';
module.exports.pluginName = 'github-listener';
