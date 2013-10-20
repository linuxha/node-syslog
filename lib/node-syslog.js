var net = require('net');
var os = require('os');
//
// node-syslog.js - TCP syslog-ng client
//

// Modified version, The version Alex wrote didn't work with my rsyslogd so I
// modified it. One problem is that I don't fully understand the node.js export
// system so I might be doing this incorrectly. 20131014

/*

CODE prioritynames[] =
  {
    { "alert", LOG_ALERT },
    { "crit", LOG_CRIT },
    { "debug", LOG_DEBUG },
    { "emerg", LOG_EMERG },
    { "err", LOG_ERR },
    { "error", LOG_ERR },               // DEPRECATED
    { "info", LOG_INFO },
    { "none", INTERNAL_NOPRI },         /* INTERNAL
    { "notice", LOG_NOTICE },
    { "panic", LOG_EMERG },             /* DEPRECATED
    { "warn", LOG_WARNING },            /* DEPRECATED
    { "warning", LOG_WARNING },
    { NULL, -1 }
  };

/* facility codes
#define LOG_KERN        (0<<3)  /* kernel messages
#define LOG_USER        (1<<3)  /* random user-level messages
#define LOG_MAIL        (2<<3)  /* mail system
#define LOG_DAEMON      (3<<3)  /* system daemons
#define LOG_AUTH        (4<<3)  /* security/authorization messages
#define LOG_SYSLOG      (5<<3)  /* messages generated internally by syslogd
#define LOG_LPR         (6<<3)  /* line printer subsystem
#define LOG_NEWS        (7<<3)  /* network news subsystem
#define LOG_UUCP        (8<<3)  /* UUCP subsystem
#define LOG_CRON        (9<<3)  /* clock daemon
#define LOG_AUTHPRIV    (10<<3) /* security/authorization messages (private)
#define LOG_FTP         (11<<3) /* ftp daemon

        /* other codes through 15 reserved for system use
#define LOG_LOCAL0      (16<<3) /* reserved for local use
#define LOG_LOCAL1      (17<<3) /* reserved for local use
#define LOG_LOCAL2      (18<<3) /* reserved for local use
#define LOG_LOCAL3      (19<<3) /* reserved for local use
#define LOG_LOCAL4      (20<<3) /* reserved for local use
#define LOG_LOCAL5      (21<<3) /* reserved for local use
#define LOG_LOCAL6      (22<<3) /* reserved for local use
#define LOG_LOCAL7      (23<<3) /* reserved for local use

 Numerical Facility

 Code

 0 kernel messages
 1 user-level messages
 2 mail system
 3 system daemons
 4 security/authorization messages (note 1)
 5 messages generated internally by syslogd
 6 line printer subsystem
 7 network news subsystem
 8 UUCP subsystem
 9 clock daemon (note 2)
 10 security/authorization messages (note 1)
 11 FTP daemon
 12 NTP subsystem
 13 log audit (note 1)
 14 log alert (note 1)
 15 clock daemon (note 2)
 16 local use 0 (local0)
 17 local use 1 (local1)
 18 local use 2 (local2)
 19 local use 3 (local3)
 20 local use 4 (local4)
 21 local use 5 (local5)
 22 local use 6 (local6)
 23 local use 7 (local7)

Note 1 - Various operating systems have been found to utilize
         Facilities 4, 10, 13 and 14 for security/authorization,
         audit, and alert messages which seem to be similar.

Note 2 - Various operating systems have been found to utilize
         both Facilities 9 and 15 for clock (cron/at) messages.

this.x = 2;

seems to behave like

 x = 2;
 module.exports.x = x;

*/
this.kern     = 0;
this.user     = 1;
this.mail     = 2;
this.daemon   = 3;
this.security = 4;
this.auth     = 4;
this.syslog   = 5;
this.lpr      = 6;
this.news     = 7;
this.uucp     = 8;
this.clock    = 9; // not an official name
this.authpriv = 10;
this.ftp      = 11;
// 13
this.audit    = 13; // not an official name
// 14
this.alert    = 14; // not an official name
this.cron     = 15;
//
this.local0   = 16;
this.local1   = 17;
this.local2   = 18;
this.local3   = 19;
this.local4   = 20;
this.local5   = 21;
this.local6   = 22;
this.local7   = 23;

// Message severity levels
this.LOG_EMERG = 0;
this.LOG_ALERT = 1;
this.LOG_CRIT = 2;
this.LOG_ERROR = 3;
this.LOG_WARNING = 4;
this.LOG_NOTICE = 5;
this.LOG_INFO = 6;
this.LOG_DEBUG = 7;

this.FACILITY_USER = this.user;

this.DEFAULT_OPTIONS = {
    facility: this.FACILITY_USER,
    name: null,
    debug: false
};

var hostname = os.hostname();

this.Client = function (port, host, options) {
    this.port = port || 514;
    this.host = host || 'localhost';
    this.options = options || {};

    for (var k in exports.DEFAULT_OPTIONS) {
        if (this.options[k] === undefined) { this.options[k] = exports.DEFAULT_OPTIONS[k] }
    }

    // We need to set this option here, incase the module is loaded before `process.title` is set.
    if (! this.options.name) { this.options.name = process.title || process.argv.join(' ') }

    this.socket = null;
    this.retries = 0;
    this.queue = [];
};
this.Client.prototype = new(function () {
    var that = this;

    // Generate logging methods, such as `info`, `debug`, ...
    for (var k in exports) {
        if (/^LOG/.test(k)) {
            (function (level, name) {
                that[name] = function (msg) {
                    this.log(msg, exports[level]);
                };
            })(k, k.match(/^LOG_([A-Z]+)/)[1].toLowerCase());
        }
    }

    /*
    ** From node.js' console.js
    **
    ** Console.prototype.log = function() {
    **     this._stdout.write(util.format.apply(this, arguments) + '\n');
	** };
	**
	** What I want is to be able to have a command line while supports variable
	** arguements like this:
	**
	** "String output: %s", s
	**     or
	** "String output: %s", s, this.LOG_WARNING
	**
	** I fear this will not be tidy. This will also require 'utils'
	**
	** function printf() { return process.stdout.write(util.format.apply(null, arguments)); }
	** util.format is very very basic: no %5d or %5.3f or %x
	** https://github.com/wdavidw/node-printf
    */
    this.log = function (msg, severity) {
        var that = this;
        msg = msg.trim();
        severity = severity !== undefined ? severity : this.LOG_INFO;

        if (severity === this.LOG_DEBUG && !this.options.debug) { return }

        this.connect(function (e) {
            var pri = '<' + ((that.options.faculty * 8) + severity) + '>'; // Message priority
	    // THis is meant for sending to a file, need to fix this
            var entryX = pri + [
                new(Date)().toJSON(),
                hostname,
                that.options.name + '[' + process.pid + ']:',
                msg
            ].join(' ') + '\n';

	    // This is meant to be sent to a syslog daemon (much simpler than the file version)
            var entry = [
                hostname,
                that.options.name + '[' + process.pid + '](' + that.options.facility + '):',
                msg
            ].join(' ') + '\n';

            // If there's a connection problem,
            // queue the message for later processing.
            //
            if (e) {
                that.queue.push(entry);
            // Write the entry to the socket
            } else {
                that.socket.write(entry, 'utf8', function (e) {
                    if (e) { that.queue.push(entry) }
                });
            }
        });
    };
    this.connect = function (callback) {
        var that = this;

        callback = callback || function () {};

        if (this.socket) {
            if (this.socket.readyState === 'open') {
                callback(null);
            } else {
                callback(true);
            }
        } else {
            callback(true);

            this.socket = net.createConnection(this.port, this.host);
            this.socket.setKeepAlive(true);
            this.socket.setNoDelay();
            this.socket.on('connect', function () {
                that.socket.write(that.queue.join(''));
                that.queue = [];
                that.retries = 0;
                that.connected = true;
            }).on('error', function (e) {
                console.log(e.message);
            }).on('end', function (e) {
            }).on('close', function (e) {
                var interval = Math.pow(2, that.retries);
                that.connected = false;
                setTimeout(function () {
                    that.retries ++;
                    that.socket.connect(that.port, that.host);
                }, interval * 1000);
            }).on('timeout', function () {
                if (that.socket.readyState !== 'open') {
                    that.socket.destroy();
                }
            });
        }
    };
});

this.createClient = function (port, host, options) {
    return new(this.Client)(port, host, options);
};
