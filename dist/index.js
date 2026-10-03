import * as os from 'os';
import os__default from 'os';
import * as crypto from 'crypto';
import * as fs from 'fs';
import { promises } from 'fs';
import 'path';
import http from 'http';
import https from 'https';
import 'net';
import require$$1 from 'tls';
import events$1 from 'events';
import 'assert';
import require$$6 from 'util';
import require$$0$1 from 'node:assert';
import require$$0$3 from 'node:net';
import require$$2 from 'node:http';
import require$$0$2 from 'node:stream';
import require$$0 from 'node:buffer';
import require$$0$4, { promisify } from 'node:util';
import require$$7 from 'node:querystring';
import require$$8 from 'node:events';
import require$$0$5 from 'node:diagnostics_channel';
import require$$5 from 'node:tls';
import require$$1$2 from 'node:zlib';
import require$$5$1 from 'node:perf_hooks';
import require$$8$1 from 'node:util/types';
import require$$1$1 from 'node:worker_threads';
import require$$1$3 from 'node:url';
import require$$5$2 from 'node:async_hooks';
import require$$1$4 from 'node:console';
import require$$1$5 from 'node:dns';
import require$$5$3 from 'string_decoder';
import 'child_process';
import 'timers';
import { readFile, readdir as readdir$1, stat as stat$1, writeFile as writeFile$1, unlink as unlink$1 } from 'node:fs/promises';
import path from 'node:path';
import { execFile as execFile$3 } from 'node:child_process';

// We use any as a valid input type
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Sanitizes an input into a string so it can be passed into issueCommand safely
 * @param input input to sanitize into a string
 */
function toCommandValue(input) {
    if (input === null || input === undefined) {
        return '';
    }
    else if (typeof input === 'string' || input instanceof String) {
        return input;
    }
    return JSON.stringify(input);
}
/**
 *
 * @param annotationProperties
 * @returns The command properties to send with the actual annotation command
 * See IssueCommandProperties: https://github.com/actions/runner/blob/main/src/Runner.Worker/ActionCommandManager.cs#L646
 */
function toCommandProperties(annotationProperties) {
    if (!Object.keys(annotationProperties).length) {
        return {};
    }
    return {
        title: annotationProperties.title,
        file: annotationProperties.file,
        line: annotationProperties.startLine,
        endLine: annotationProperties.endLine,
        col: annotationProperties.startColumn,
        endColumn: annotationProperties.endColumn
    };
}

/**
 * Issues a command to the GitHub Actions runner
 *
 * @param command - The command name to issue
 * @param properties - Additional properties for the command (key-value pairs)
 * @param message - The message to include with the command
 * @remarks
 * This function outputs a specially formatted string to stdout that the Actions
 * runner interprets as a command. These commands can control workflow behavior,
 * set outputs, create annotations, mask values, and more.
 *
 * Command Format:
 *   ::name key=value,key=value::message
 *
 * @example
 * ```typescript
 * // Issue a warning annotation
 * issueCommand('warning', {}, 'This is a warning message');
 * // Output: ::warning::This is a warning message
 *
 * // Set an environment variable
 * issueCommand('set-env', { name: 'MY_VAR' }, 'some value');
 * // Output: ::set-env name=MY_VAR::some value
 *
 * // Add a secret mask
 * issueCommand('add-mask', {}, 'secretValue123');
 * // Output: ::add-mask::secretValue123
 * ```
 *
 * @internal
 * This is an internal utility function that powers the public API functions
 * such as setSecret, warning, error, and exportVariable.
 */
function issueCommand(command, properties, message) {
    const cmd = new Command(command, properties, message);
    process.stdout.write(cmd.toString() + os.EOL);
}
const CMD_STRING = '::';
class Command {
    constructor(command, properties, message) {
        if (!command) {
            command = 'missing.command';
        }
        this.command = command;
        this.properties = properties;
        this.message = message;
    }
    toString() {
        let cmdStr = CMD_STRING + this.command;
        if (this.properties && Object.keys(this.properties).length > 0) {
            cmdStr += ' ';
            let first = true;
            for (const key in this.properties) {
                if (this.properties.hasOwnProperty(key)) {
                    const val = this.properties[key];
                    if (val) {
                        if (first) {
                            first = false;
                        }
                        else {
                            cmdStr += ',';
                        }
                        cmdStr += `${key}=${escapeProperty(val)}`;
                    }
                }
            }
        }
        cmdStr += `${CMD_STRING}${escapeData(this.message)}`;
        return cmdStr;
    }
}
function escapeData(s) {
    return toCommandValue(s)
        .replace(/%/g, '%25')
        .replace(/\r/g, '%0D')
        .replace(/\n/g, '%0A');
}
function escapeProperty(s) {
    return toCommandValue(s)
        .replace(/%/g, '%25')
        .replace(/\r/g, '%0D')
        .replace(/\n/g, '%0A')
        .replace(/:/g, '%3A')
        .replace(/,/g, '%2C');
}

// For internal use, subject to change.
// We use any as a valid input type
/* eslint-disable @typescript-eslint/no-explicit-any */
function issueFileCommand(command, message) {
    const filePath = process.env[`GITHUB_${command}`];
    if (!filePath) {
        throw new Error(`Unable to find environment variable for file command ${command}`);
    }
    if (!fs.existsSync(filePath)) {
        throw new Error(`Missing file at path: ${filePath}`);
    }
    fs.appendFileSync(filePath, `${toCommandValue(message)}${os.EOL}`, {
        encoding: 'utf8'
    });
}
function prepareKeyValueMessage(key, value) {
    const delimiter = `ghadelimiter_${crypto.randomUUID()}`;
    const convertedValue = toCommandValue(value);
    // These should realistically never happen, but just in case someone finds a
    // way to exploit uuid generation let's not allow keys or values that contain
    // the delimiter.
    if (key.includes(delimiter)) {
        throw new Error(`Unexpected input: name should not contain the delimiter "${delimiter}"`);
    }
    if (convertedValue.includes(delimiter)) {
        throw new Error(`Unexpected input: value should not contain the delimiter "${delimiter}"`);
    }
    return `${key}<<${delimiter}${os.EOL}${convertedValue}${os.EOL}${delimiter}`;
}

var commonjsGlobal = typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : typeof self !== 'undefined' ? self : {};

var tunnel$1 = {};

var hasRequiredTunnel$1;

function requireTunnel$1 () {
	if (hasRequiredTunnel$1) return tunnel$1;
	hasRequiredTunnel$1 = 1;
	var tls = require$$1;
	var http$1 = http;
	var https$1 = https;
	var events = events$1;
	var util = require$$6;


	tunnel$1.httpOverHttp = httpOverHttp;
	tunnel$1.httpsOverHttp = httpsOverHttp;
	tunnel$1.httpOverHttps = httpOverHttps;
	tunnel$1.httpsOverHttps = httpsOverHttps;


	function httpOverHttp(options) {
	  var agent = new TunnelingAgent(options);
	  agent.request = http$1.request;
	  return agent;
	}

	function httpsOverHttp(options) {
	  var agent = new TunnelingAgent(options);
	  agent.request = http$1.request;
	  agent.createSocket = createSecureSocket;
	  agent.defaultPort = 443;
	  return agent;
	}

	function httpOverHttps(options) {
	  var agent = new TunnelingAgent(options);
	  agent.request = https$1.request;
	  return agent;
	}

	function httpsOverHttps(options) {
	  var agent = new TunnelingAgent(options);
	  agent.request = https$1.request;
	  agent.createSocket = createSecureSocket;
	  agent.defaultPort = 443;
	  return agent;
	}


	function TunnelingAgent(options) {
	  var self = this;
	  self.options = options || {};
	  self.proxyOptions = self.options.proxy || {};
	  self.maxSockets = self.options.maxSockets || http$1.Agent.defaultMaxSockets;
	  self.requests = [];
	  self.sockets = [];

	  self.on('free', function onFree(socket, host, port, localAddress) {
	    var options = toOptions(host, port, localAddress);
	    for (var i = 0, len = self.requests.length; i < len; ++i) {
	      var pending = self.requests[i];
	      if (pending.host === options.host && pending.port === options.port) {
	        // Detect the request to connect same origin server,
	        // reuse the connection.
	        self.requests.splice(i, 1);
	        pending.request.onSocket(socket);
	        return;
	      }
	    }
	    socket.destroy();
	    self.removeSocket(socket);
	  });
	}
	util.inherits(TunnelingAgent, events.EventEmitter);

	TunnelingAgent.prototype.addRequest = function addRequest(req, host, port, localAddress) {
	  var self = this;
	  var options = mergeOptions({request: req}, self.options, toOptions(host, port, localAddress));

	  if (self.sockets.length >= this.maxSockets) {
	    // We are over limit so we'll add it to the queue.
	    self.requests.push(options);
	    return;
	  }

	  // If we are under maxSockets create a new one.
	  self.createSocket(options, function(socket) {
	    socket.on('free', onFree);
	    socket.on('close', onCloseOrRemove);
	    socket.on('agentRemove', onCloseOrRemove);
	    req.onSocket(socket);

	    function onFree() {
	      self.emit('free', socket, options);
	    }

	    function onCloseOrRemove(err) {
	      self.removeSocket(socket);
	      socket.removeListener('free', onFree);
	      socket.removeListener('close', onCloseOrRemove);
	      socket.removeListener('agentRemove', onCloseOrRemove);
	    }
	  });
	};

	TunnelingAgent.prototype.createSocket = function createSocket(options, cb) {
	  var self = this;
	  var placeholder = {};
	  self.sockets.push(placeholder);

	  var connectOptions = mergeOptions({}, self.proxyOptions, {
	    method: 'CONNECT',
	    path: options.host + ':' + options.port,
	    agent: false,
	    headers: {
	      host: options.host + ':' + options.port
	    }
	  });
	  if (options.localAddress) {
	    connectOptions.localAddress = options.localAddress;
	  }
	  if (connectOptions.proxyAuth) {
	    connectOptions.headers = connectOptions.headers || {};
	    connectOptions.headers['Proxy-Authorization'] = 'Basic ' +
	        new Buffer(connectOptions.proxyAuth).toString('base64');
	  }

	  debug('making CONNECT request');
	  var connectReq = self.request(connectOptions);
	  connectReq.useChunkedEncodingByDefault = false; // for v0.6
	  connectReq.once('response', onResponse); // for v0.6
	  connectReq.once('upgrade', onUpgrade);   // for v0.6
	  connectReq.once('connect', onConnect);   // for v0.7 or later
	  connectReq.once('error', onError);
	  connectReq.end();

	  function onResponse(res) {
	    // Very hacky. This is necessary to avoid http-parser leaks.
	    res.upgrade = true;
	  }

	  function onUpgrade(res, socket, head) {
	    // Hacky.
	    process.nextTick(function() {
	      onConnect(res, socket, head);
	    });
	  }

	  function onConnect(res, socket, head) {
	    connectReq.removeAllListeners();
	    socket.removeAllListeners();

	    if (res.statusCode !== 200) {
	      debug('tunneling socket could not be established, statusCode=%d',
	        res.statusCode);
	      socket.destroy();
	      var error = new Error('tunneling socket could not be established, ' +
	        'statusCode=' + res.statusCode);
	      error.code = 'ECONNRESET';
	      options.request.emit('error', error);
	      self.removeSocket(placeholder);
	      return;
	    }
	    if (head.length > 0) {
	      debug('got illegal response body from proxy');
	      socket.destroy();
	      var error = new Error('got illegal response body from proxy');
	      error.code = 'ECONNRESET';
	      options.request.emit('error', error);
	      self.removeSocket(placeholder);
	      return;
	    }
	    debug('tunneling connection has established');
	    self.sockets[self.sockets.indexOf(placeholder)] = socket;
	    return cb(socket);
	  }

	  function onError(cause) {
	    connectReq.removeAllListeners();

	    debug('tunneling socket could not be established, cause=%s\n',
	          cause.message, cause.stack);
	    var error = new Error('tunneling socket could not be established, ' +
	                          'cause=' + cause.message);
	    error.code = 'ECONNRESET';
	    options.request.emit('error', error);
	    self.removeSocket(placeholder);
	  }
	};

	TunnelingAgent.prototype.removeSocket = function removeSocket(socket) {
	  var pos = this.sockets.indexOf(socket);
	  if (pos === -1) {
	    return;
	  }
	  this.sockets.splice(pos, 1);

	  var pending = this.requests.shift();
	  if (pending) {
	    // If we have pending requests and a socket gets closed a new one
	    // needs to be created to take over in the pool for the one that closed.
	    this.createSocket(pending, function(socket) {
	      pending.request.onSocket(socket);
	    });
	  }
	};

	function createSecureSocket(options, cb) {
	  var self = this;
	  TunnelingAgent.prototype.createSocket.call(self, options, function(socket) {
	    var hostHeader = options.request.getHeader('host');
	    var tlsOptions = mergeOptions({}, self.options, {
	      socket: socket,
	      servername: hostHeader ? hostHeader.replace(/:.*$/, '') : options.host
	    });

	    // 0 is dummy port for v0.6
	    var secureSocket = tls.connect(0, tlsOptions);
	    self.sockets[self.sockets.indexOf(socket)] = secureSocket;
	    cb(secureSocket);
	  });
	}


	function toOptions(host, port, localAddress) {
	  if (typeof host === 'string') { // since v0.10
	    return {
	      host: host,
	      port: port,
	      localAddress: localAddress
	    };
	  }
	  return host; // for v0.11 or later
	}

	function mergeOptions(target) {
	  for (var i = 1, len = arguments.length; i < len; ++i) {
	    var overrides = arguments[i];
	    if (typeof overrides === 'object') {
	      var keys = Object.keys(overrides);
	      for (var j = 0, keyLen = keys.length; j < keyLen; ++j) {
	        var k = keys[j];
	        if (overrides[k] !== undefined) {
	          target[k] = overrides[k];
	        }
	      }
	    }
	  }
	  return target;
	}


	var debug;
	if (process.env.NODE_DEBUG && /\btunnel\b/.test(process.env.NODE_DEBUG)) {
	  debug = function() {
	    var args = Array.prototype.slice.call(arguments);
	    if (typeof args[0] === 'string') {
	      args[0] = 'TUNNEL: ' + args[0];
	    } else {
	      args.unshift('TUNNEL:');
	    }
	    console.error.apply(console, args);
	  };
	} else {
	  debug = function() {};
	}
	tunnel$1.debug = debug; // for test
	return tunnel$1;
}

var tunnel;
var hasRequiredTunnel;

function requireTunnel () {
	if (hasRequiredTunnel) return tunnel;
	hasRequiredTunnel = 1;
	tunnel = requireTunnel$1();
	return tunnel;
}

requireTunnel();

var undici = {};

var symbols$4;
var hasRequiredSymbols$4;

function requireSymbols$4 () {
	if (hasRequiredSymbols$4) return symbols$4;
	hasRequiredSymbols$4 = 1;
	symbols$4 = {
	  kClose: Symbol('close'),
	  kDestroy: Symbol('destroy'),
	  kDispatch: Symbol('dispatch'),
	  kUrl: Symbol('url'),
	  kWriting: Symbol('writing'),
	  kResuming: Symbol('resuming'),
	  kQueue: Symbol('queue'),
	  kConnect: Symbol('connect'),
	  kConnecting: Symbol('connecting'),
	  kKeepAliveDefaultTimeout: Symbol('default keep alive timeout'),
	  kKeepAliveMaxTimeout: Symbol('max keep alive timeout'),
	  kKeepAliveTimeoutThreshold: Symbol('keep alive timeout threshold'),
	  kKeepAliveTimeoutValue: Symbol('keep alive timeout'),
	  kKeepAlive: Symbol('keep alive'),
	  kHeadersTimeout: Symbol('headers timeout'),
	  kBodyTimeout: Symbol('body timeout'),
	  kServerName: Symbol('server name'),
	  kLocalAddress: Symbol('local address'),
	  kHost: Symbol('host'),
	  kNoRef: Symbol('no ref'),
	  kBodyUsed: Symbol('used'),
	  kBody: Symbol('abstracted request body'),
	  kRunning: Symbol('running'),
	  kBlocking: Symbol('blocking'),
	  kPending: Symbol('pending'),
	  kSize: Symbol('size'),
	  kBusy: Symbol('busy'),
	  kQueued: Symbol('queued'),
	  kFree: Symbol('free'),
	  kConnected: Symbol('connected'),
	  kClosed: Symbol('closed'),
	  kNeedDrain: Symbol('need drain'),
	  kReset: Symbol('reset'),
	  kDestroyed: Symbol.for('nodejs.stream.destroyed'),
	  kResume: Symbol('resume'),
	  kOnError: Symbol('on error'),
	  kMaxHeadersSize: Symbol('max headers size'),
	  kRunningIdx: Symbol('running index'),
	  kPendingIdx: Symbol('pending index'),
	  kError: Symbol('error'),
	  kClients: Symbol('clients'),
	  kClient: Symbol('client'),
	  kParser: Symbol('parser'),
	  kOnDestroyed: Symbol('destroy callbacks'),
	  kPipelining: Symbol('pipelining'),
	  kSocket: Symbol('socket'),
	  kHostHeader: Symbol('host header'),
	  kConnector: Symbol('connector'),
	  kStrictContentLength: Symbol('strict content length'),
	  kMaxRedirections: Symbol('maxRedirections'),
	  kMaxRequests: Symbol('maxRequestsPerClient'),
	  kProxy: Symbol('proxy agent options'),
	  kCounter: Symbol('socket request counter'),
	  kInterceptors: Symbol('dispatch interceptors'),
	  kMaxResponseSize: Symbol('max response size'),
	  kHTTP2Session: Symbol('http2Session'),
	  kHTTP2SessionState: Symbol('http2Session state'),
	  kRetryHandlerDefaultRetry: Symbol('retry agent default retry'),
	  kConstruct: Symbol('constructable'),
	  kListeners: Symbol('listeners'),
	  kHTTPContext: Symbol('http context'),
	  kMaxConcurrentStreams: Symbol('max concurrent streams'),
	  kNoProxyAgent: Symbol('no proxy agent'),
	  kHttpProxyAgent: Symbol('http proxy agent'),
	  kHttpsProxyAgent: Symbol('https proxy agent')
	};
	return symbols$4;
}

var errors;
var hasRequiredErrors;

function requireErrors () {
	if (hasRequiredErrors) return errors;
	hasRequiredErrors = 1;

	const kUndiciError = Symbol.for('undici.error.UND_ERR');
	class UndiciError extends Error {
	  constructor (message) {
	    super(message);
	    this.name = 'UndiciError';
	    this.code = 'UND_ERR';
	  }

	  static [Symbol.hasInstance] (instance) {
	    return instance && instance[kUndiciError] === true
	  }

	  [kUndiciError] = true
	}

	const kConnectTimeoutError = Symbol.for('undici.error.UND_ERR_CONNECT_TIMEOUT');
	class ConnectTimeoutError extends UndiciError {
	  constructor (message) {
	    super(message);
	    this.name = 'ConnectTimeoutError';
	    this.message = message || 'Connect Timeout Error';
	    this.code = 'UND_ERR_CONNECT_TIMEOUT';
	  }

	  static [Symbol.hasInstance] (instance) {
	    return instance && instance[kConnectTimeoutError] === true
	  }

	  [kConnectTimeoutError] = true
	}

	const kHeadersTimeoutError = Symbol.for('undici.error.UND_ERR_HEADERS_TIMEOUT');
	class HeadersTimeoutError extends UndiciError {
	  constructor (message) {
	    super(message);
	    this.name = 'HeadersTimeoutError';
	    this.message = message || 'Headers Timeout Error';
	    this.code = 'UND_ERR_HEADERS_TIMEOUT';
	  }

	  static [Symbol.hasInstance] (instance) {
	    return instance && instance[kHeadersTimeoutError] === true
	  }

	  [kHeadersTimeoutError] = true
	}

	const kHeadersOverflowError = Symbol.for('undici.error.UND_ERR_HEADERS_OVERFLOW');
	class HeadersOverflowError extends UndiciError {
	  constructor (message) {
	    super(message);
	    this.name = 'HeadersOverflowError';
	    this.message = message || 'Headers Overflow Error';
	    this.code = 'UND_ERR_HEADERS_OVERFLOW';
	  }

	  static [Symbol.hasInstance] (instance) {
	    return instance && instance[kHeadersOverflowError] === true
	  }

	  [kHeadersOverflowError] = true
	}

	const kBodyTimeoutError = Symbol.for('undici.error.UND_ERR_BODY_TIMEOUT');
	class BodyTimeoutError extends UndiciError {
	  constructor (message) {
	    super(message);
	    this.name = 'BodyTimeoutError';
	    this.message = message || 'Body Timeout Error';
	    this.code = 'UND_ERR_BODY_TIMEOUT';
	  }

	  static [Symbol.hasInstance] (instance) {
	    return instance && instance[kBodyTimeoutError] === true
	  }

	  [kBodyTimeoutError] = true
	}

	const kResponseStatusCodeError = Symbol.for('undici.error.UND_ERR_RESPONSE_STATUS_CODE');
	class ResponseStatusCodeError extends UndiciError {
	  constructor (message, statusCode, headers, body) {
	    super(message);
	    this.name = 'ResponseStatusCodeError';
	    this.message = message || 'Response Status Code Error';
	    this.code = 'UND_ERR_RESPONSE_STATUS_CODE';
	    this.body = body;
	    this.status = statusCode;
	    this.statusCode = statusCode;
	    this.headers = headers;
	  }

	  static [Symbol.hasInstance] (instance) {
	    return instance && instance[kResponseStatusCodeError] === true
	  }

	  [kResponseStatusCodeError] = true
	}

	const kInvalidArgumentError = Symbol.for('undici.error.UND_ERR_INVALID_ARG');
	class InvalidArgumentError extends UndiciError {
	  constructor (message) {
	    super(message);
	    this.name = 'InvalidArgumentError';
	    this.message = message || 'Invalid Argument Error';
	    this.code = 'UND_ERR_INVALID_ARG';
	  }

	  static [Symbol.hasInstance] (instance) {
	    return instance && instance[kInvalidArgumentError] === true
	  }

	  [kInvalidArgumentError] = true
	}

	const kInvalidReturnValueError = Symbol.for('undici.error.UND_ERR_INVALID_RETURN_VALUE');
	class InvalidReturnValueError extends UndiciError {
	  constructor (message) {
	    super(message);
	    this.name = 'InvalidReturnValueError';
	    this.message = message || 'Invalid Return Value Error';
	    this.code = 'UND_ERR_INVALID_RETURN_VALUE';
	  }

	  static [Symbol.hasInstance] (instance) {
	    return instance && instance[kInvalidReturnValueError] === true
	  }

	  [kInvalidReturnValueError] = true
	}

	const kAbortError = Symbol.for('undici.error.UND_ERR_ABORT');
	class AbortError extends UndiciError {
	  constructor (message) {
	    super(message);
	    this.name = 'AbortError';
	    this.message = message || 'The operation was aborted';
	    this.code = 'UND_ERR_ABORT';
	  }

	  static [Symbol.hasInstance] (instance) {
	    return instance && instance[kAbortError] === true
	  }

	  [kAbortError] = true
	}

	const kRequestAbortedError = Symbol.for('undici.error.UND_ERR_ABORTED');
	class RequestAbortedError extends AbortError {
	  constructor (message) {
	    super(message);
	    this.name = 'AbortError';
	    this.message = message || 'Request aborted';
	    this.code = 'UND_ERR_ABORTED';
	  }

	  static [Symbol.hasInstance] (instance) {
	    return instance && instance[kRequestAbortedError] === true
	  }

	  [kRequestAbortedError] = true
	}

	const kInformationalError = Symbol.for('undici.error.UND_ERR_INFO');
	class InformationalError extends UndiciError {
	  constructor (message) {
	    super(message);
	    this.name = 'InformationalError';
	    this.message = message || 'Request information';
	    this.code = 'UND_ERR_INFO';
	  }

	  static [Symbol.hasInstance] (instance) {
	    return instance && instance[kInformationalError] === true
	  }

	  [kInformationalError] = true
	}

	const kRequestContentLengthMismatchError = Symbol.for('undici.error.UND_ERR_REQ_CONTENT_LENGTH_MISMATCH');
	class RequestContentLengthMismatchError extends UndiciError {
	  constructor (message) {
	    super(message);
	    this.name = 'RequestContentLengthMismatchError';
	    this.message = message || 'Request body length does not match content-length header';
	    this.code = 'UND_ERR_REQ_CONTENT_LENGTH_MISMATCH';
	  }

	  static [Symbol.hasInstance] (instance) {
	    return instance && instance[kRequestContentLengthMismatchError] === true
	  }

	  [kRequestContentLengthMismatchError] = true
	}

	const kResponseContentLengthMismatchError = Symbol.for('undici.error.UND_ERR_RES_CONTENT_LENGTH_MISMATCH');
	class ResponseContentLengthMismatchError extends UndiciError {
	  constructor (message) {
	    super(message);
	    this.name = 'ResponseContentLengthMismatchError';
	    this.message = message || 'Response body length does not match content-length header';
	    this.code = 'UND_ERR_RES_CONTENT_LENGTH_MISMATCH';
	  }

	  static [Symbol.hasInstance] (instance) {
	    return instance && instance[kResponseContentLengthMismatchError] === true
	  }

	  [kResponseContentLengthMismatchError] = true
	}

	const kClientDestroyedError = Symbol.for('undici.error.UND_ERR_DESTROYED');
	class ClientDestroyedError extends UndiciError {
	  constructor (message) {
	    super(message);
	    this.name = 'ClientDestroyedError';
	    this.message = message || 'The client is destroyed';
	    this.code = 'UND_ERR_DESTROYED';
	  }

	  static [Symbol.hasInstance] (instance) {
	    return instance && instance[kClientDestroyedError] === true
	  }

	  [kClientDestroyedError] = true
	}

	const kClientClosedError = Symbol.for('undici.error.UND_ERR_CLOSED');
	class ClientClosedError extends UndiciError {
	  constructor (message) {
	    super(message);
	    this.name = 'ClientClosedError';
	    this.message = message || 'The client is closed';
	    this.code = 'UND_ERR_CLOSED';
	  }

	  static [Symbol.hasInstance] (instance) {
	    return instance && instance[kClientClosedError] === true
	  }

	  [kClientClosedError] = true
	}

	const kSocketError = Symbol.for('undici.error.UND_ERR_SOCKET');
	class SocketError extends UndiciError {
	  constructor (message, socket) {
	    super(message);
	    this.name = 'SocketError';
	    this.message = message || 'Socket error';
	    this.code = 'UND_ERR_SOCKET';
	    this.socket = socket;
	  }

	  static [Symbol.hasInstance] (instance) {
	    return instance && instance[kSocketError] === true
	  }

	  [kSocketError] = true
	}

	const kNotSupportedError = Symbol.for('undici.error.UND_ERR_NOT_SUPPORTED');
	class NotSupportedError extends UndiciError {
	  constructor (message) {
	    super(message);
	    this.name = 'NotSupportedError';
	    this.message = message || 'Not supported error';
	    this.code = 'UND_ERR_NOT_SUPPORTED';
	  }

	  static [Symbol.hasInstance] (instance) {
	    return instance && instance[kNotSupportedError] === true
	  }

	  [kNotSupportedError] = true
	}

	const kBalancedPoolMissingUpstreamError = Symbol.for('undici.error.UND_ERR_BPL_MISSING_UPSTREAM');
	class BalancedPoolMissingUpstreamError extends UndiciError {
	  constructor (message) {
	    super(message);
	    this.name = 'MissingUpstreamError';
	    this.message = message || 'No upstream has been added to the BalancedPool';
	    this.code = 'UND_ERR_BPL_MISSING_UPSTREAM';
	  }

	  static [Symbol.hasInstance] (instance) {
	    return instance && instance[kBalancedPoolMissingUpstreamError] === true
	  }

	  [kBalancedPoolMissingUpstreamError] = true
	}

	const kHTTPParserError = Symbol.for('undici.error.UND_ERR_HTTP_PARSER');
	class HTTPParserError extends Error {
	  constructor (message, code, data) {
	    super(message);
	    this.name = 'HTTPParserError';
	    this.code = code ? `HPE_${code}` : undefined;
	    this.data = data ? data.toString() : undefined;
	  }

	  static [Symbol.hasInstance] (instance) {
	    return instance && instance[kHTTPParserError] === true
	  }

	  [kHTTPParserError] = true
	}

	const kResponseExceededMaxSizeError = Symbol.for('undici.error.UND_ERR_RES_EXCEEDED_MAX_SIZE');
	class ResponseExceededMaxSizeError extends UndiciError {
	  constructor (message) {
	    super(message);
	    this.name = 'ResponseExceededMaxSizeError';
	    this.message = message || 'Response content exceeded max size';
	    this.code = 'UND_ERR_RES_EXCEEDED_MAX_SIZE';
	  }

	  static [Symbol.hasInstance] (instance) {
	    return instance && instance[kResponseExceededMaxSizeError] === true
	  }

	  [kResponseExceededMaxSizeError] = true
	}

	const kRequestRetryError = Symbol.for('undici.error.UND_ERR_REQ_RETRY');
	class RequestRetryError extends UndiciError {
	  constructor (message, code, { headers, data }) {
	    super(message);
	    this.name = 'RequestRetryError';
	    this.message = message || 'Request retry error';
	    this.code = 'UND_ERR_REQ_RETRY';
	    this.statusCode = code;
	    this.data = data;
	    this.headers = headers;
	  }

	  static [Symbol.hasInstance] (instance) {
	    return instance && instance[kRequestRetryError] === true
	  }

	  [kRequestRetryError] = true
	}

	const kResponseError = Symbol.for('undici.error.UND_ERR_RESPONSE');
	class ResponseError extends UndiciError {
	  constructor (message, code, { headers, data }) {
	    super(message);
	    this.name = 'ResponseError';
	    this.message = message || 'Response error';
	    this.code = 'UND_ERR_RESPONSE';
	    this.statusCode = code;
	    this.data = data;
	    this.headers = headers;
	  }

	  static [Symbol.hasInstance] (instance) {
	    return instance && instance[kResponseError] === true
	  }

	  [kResponseError] = true
	}

	const kSecureProxyConnectionError = Symbol.for('undici.error.UND_ERR_PRX_TLS');
	class SecureProxyConnectionError extends UndiciError {
	  constructor (cause, message, options) {
	    super(message, { cause, ...(options ?? {}) });
	    this.name = 'SecureProxyConnectionError';
	    this.message = message || 'Secure Proxy Connection failed';
	    this.code = 'UND_ERR_PRX_TLS';
	    this.cause = cause;
	  }

	  static [Symbol.hasInstance] (instance) {
	    return instance && instance[kSecureProxyConnectionError] === true
	  }

	  [kSecureProxyConnectionError] = true
	}

	const kMessageSizeExceededError = Symbol.for('undici.error.UND_ERR_WS_MESSAGE_SIZE_EXCEEDED');
	class MessageSizeExceededError extends UndiciError {
	  constructor (message) {
	    super(message);
	    this.name = 'MessageSizeExceededError';
	    this.message = message || 'Max decompressed message size exceeded';
	    this.code = 'UND_ERR_WS_MESSAGE_SIZE_EXCEEDED';
	  }

	  static [Symbol.hasInstance] (instance) {
	    return instance && instance[kMessageSizeExceededError] === true
	  }

	  get [kMessageSizeExceededError] () {
	    return true
	  }
	}

	errors = {
	  AbortError,
	  HTTPParserError,
	  UndiciError,
	  HeadersTimeoutError,
	  HeadersOverflowError,
	  BodyTimeoutError,
	  RequestContentLengthMismatchError,
	  ConnectTimeoutError,
	  ResponseStatusCodeError,
	  InvalidArgumentError,
	  InvalidReturnValueError,
	  RequestAbortedError,
	  ClientDestroyedError,
	  ClientClosedError,
	  InformationalError,
	  SocketError,
	  NotSupportedError,
	  ResponseContentLengthMismatchError,
	  BalancedPoolMissingUpstreamError,
	  ResponseExceededMaxSizeError,
	  RequestRetryError,
	  ResponseError,
	  SecureProxyConnectionError,
	  MessageSizeExceededError
	};
	return errors;
}

var constants$4;
var hasRequiredConstants$4;

function requireConstants$4 () {
	if (hasRequiredConstants$4) return constants$4;
	hasRequiredConstants$4 = 1;

	/** @type {Record<string, string | undefined>} */
	const headerNameLowerCasedRecord = {};

	// https://developer.mozilla.org/docs/Web/HTTP/Headers
	const wellknownHeaderNames = [
	  'Accept',
	  'Accept-Encoding',
	  'Accept-Language',
	  'Accept-Ranges',