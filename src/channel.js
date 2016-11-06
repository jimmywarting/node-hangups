"use strict"

const
CookieJar  = require('tough-cookie').CookieJar,
crypto     = require('crypto'),
https      = require("https"),
debug      = require('debug')('hangups:channel'),
PushParser = require('./pushdataparser'),
util       = require('./util'),

pollAgent = new https.Agent({
	keepAlive: true,
	maxSockets: 1,
	keepAliveMsecs: 3E5 // 5 min
}),

sleep          = util.sleep,
NetworkError   = util.NetworkError,
MAX_RETRIES    = 5,
ABORT          = Symbol("Abort"),
ORIGIN_URL     = 'https://talkgadget.google.com',
CHANNEL_URL    = 'https://0.client-channel.google.com/client-channel/channel/bind',
UA             = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_10_2) AppleWebKit/537.36' +
	             '(KHTML, like Gecko) Chrome/41.0.2272.118 Safari/537.36',

isUnknownSID = res => res.status == 400 && res.statusText == 'Unknown SID',

getAuthorizationHeaders = (sapisid, msec, origin) => {
	const
	auth_string = `${msec} ${sapisid} ${origin}`,
	auth_hash = crypto.createHash('sha1').update(auth_string).digest('hex')

	return {
		authorization: `SAPISIDHASH ${msec}_${auth_hash}`,
		'x-origin': origin,
		'x-goog-authuser': '0'
	}
},

sapisidof = fetch => {
	const
	cookies = fetch.jar.getCookiesSync(ORIGIN_URL),
	cookie = cookies.find(cookie => cookie.key === 'SAPISID')

	return cookie && cookie.value
}


class Channel {

	constructor (jarstore, fetch) {
		this.fetch = fetch
		this.jarstore = jarstore
		this.pushParser = new PushParser()
	}



	/**
	 * [authHeaders description]
	 * @return {[type]} [description]
	 */
	authHeaders () {
		var sapisid = sapisidof(this.fetch)

		if (!sapisid) {
			debug('no SAPISID cookie')
			return null
		}

		return getAuthorizationHeaders(sapisid, Date.now(), ORIGIN_URL)
	}



	/**
	 * Parse response format for request for new channel SID.
	 *
	 * @return {Promise} containing
	 *
	 * @resolves {sid, gsid} If response was successful
	 */
	async fetchSid () {
		var auth = this.authHeaders()

		if(!auth)
			throw new Error("No auth headers")

		var opts = {
			method: 'POST',
			headers: auth,
			qs: {
				VER: 8,
				RID: 81187,
				ctype: 'hangouts'
			}
		}

		let res = await this.fetch(CHANNEL_URL, opts)
		let text = await res.text()

		if (res.status !== 200) {
			debug('failed to get sid', res.statusCode, text)
			return
		}

		// Example format (after parsing JS):
		// [ [0,["c","SID_HERE","",8]],
		//   [1,[{"gsid":"GSESSIONID_HERE"}]] ]

		let p = new PushParser(Buffer.from(text)),
			line = p.pop(),
			result = {
				sid: line[0][1][1],
				gsid: line[1][1][0].gsid
			}

		debug('found sid/gsid', result.sid, result.gsid)
		return result
	}



	/**
	 * get next messages from channel
	 *
	 * @return {[type]} [description]
	 */
	getLines () {
		if (!this.running)
			this.start()

		return this.pushParser.allLines()
	}



	/**
	 * start polling
	 *
	 * @return {Promise}
	 * @resolves {Undefined} If channel stops running
	 */
	async start () {
		var retries = MAX_RETRIES
		this.running = true
		this.sid = null // ensures we get a new sid
		this.gsid = null
		this.subscribed = false

		// graceful stop of polling
		while(this.running) {

			await this.poll(retries)
			.then(() => {
				// XXX we only reset to MAX_RETRIES after a full ended
				// poll. this means in bad network conditions we get an
				// edge case where retries never reset despite getting
				// (interrupted) good polls. perhaps move retries to
				// instance var?
				retries = MAX_RETRIES // reset on success
			})
			.catch(err => {
				// abort token is not an error
				if (err == ABORT)
					return

				retries--
				debug('poll error', err)

				if (retries <= 0) {
					this.running = false
					// resetting with error makes pushParser.allLines()
					// resolve with that error, which in turn makes
					// this.getLines() propagate the error out.
					this.pushParser.reset(err)
				}
			})
		}
	}



	/**
	 * Gracefully stop polling
	 *
	 * @return {Undefined}
	 */
	stop () {
		debug('channel stop')

		this.running = false
        // this releases the this.getLines() promise
        this.pushParser.reset()
        // abort current request
        if(this.currentReq){
        	// If only fetch had a abort method...
        	// https://github.com/whatwg/fetch/issues/27
        	// this.currentReq.abort()

        	// Maybe this will do for now
        	this.currentReq.body.emit('_stop')
        }
	}



	/**
	 * [poll description]
	 *
	 * @todo fix description
	 * @param  {Number}  retries [description]
	 * @return {Promise}         [description]
	 */
	async poll (retries) {
		var backoffTime = 2 * (MAX_RETRIES - retries) * 1000
		if (backoffTime)
			debug('backing off for', backoffTime, 'ms')

		await sleep(backoffTime)

		if(!this.running)
			return Promise.reject(ABORT)

		if (!this.sid) {
			let o = await this.fetchSid()
			Object.assign(this, o)
			this.pushParser.reset()
		}

		return this.reqpoll()
	}



	/**
	 * Long polling
	 *
	 * @return {Promise}
	 *
	 * @rejects  {NetworkError} If channel url don't return status 200
	 * @rejects  {Abort}        If clients stops
	 * @resolves {undefined}    If success
	 */
	reqpoll () {
		// we don't use generator + await here
		// sence we don't want to await meta data + response text
		// at the end. We parse data as it comes in
		//
		// Guess this is not how node-fetch is inteded to work...
		// If I would have done it today in Chrome that don't have
		// pipes then I would have use res.body.reader()
		// If node-fetch would have had `reader()` then we wouldn't need
		// a promise wrapper since that would flush data as it reads and
		// and resolves when done... Could simply use return res.text()
		// at the end but we don't want to keep all data in memory
		//
		// But on the other hand. it looks like res.body.pipe(Through)
		// is something of the feature?
		// https://jakearchibald.com/2015/thats-so-fetch/#streams
		return new Promise((resolve, reject) => {
			debug('long poll req')
			let opts = {
				agent: pollAgent,
				headers: this.authHeaders(),
				qs: {
					CI: 0,
					ctype: 'hangouts',
					gsessionid: this.gsid,
					RID: 'rpc',
					SID: this.sid,
					t: 1,
					TYPE: 'xmlhttp',
					VER: 8,
				}
			}

			// lack motivation to add co-generator in this scope...
			// You don't always have over do things...
			/* res = await */ this.fetch(CHANNEL_URL, opts).then(res => {

			this.currentReq = res

			debug('long poll response', res.status, res.statusText)
			if ( isUnknownSID(res) ) {
				debug('sid became invalid')
				this.sid = null
				this.gsid = null
				this.subscribed = false
				return resolve() // what we want?
			} else if (res.status != 200) {
				throw NetworkError(res)
			}

			res.body.once('_stop', chunk => {
				res.body.removeAllListeners('data')
				res.body.removeAllListeners('error')
				res.body.removeAllListeners('end')
				resolve()
			})

			res.body.on('data', chunk => {
				this.pushParser.parse(chunk)

				if (!this.subscribed)
					return this.subscribe()
			})

			res.body.once('error', err => {
				debug('long poll error', err)
				 // throwing in here don't make any diffrent
				 // to the outer function. so we need to use
				 // reject
				reject(err)
				res.body.removeAllListeners('_stop')
				res.body.removeAllListeners('data')
				res.body.removeAllListeners('end')
			})

			res.body.on('end', () => {
				resolve(/* success */)
				res.body.removeAllListeners('_stop')
				res.body.removeAllListeners('data')
				res.body.removeAllListeners('error')
				res = res.body = null
			})

		/* end "await" */ })
		})
	}



	/**
	 * Subscribes the channel to receive relevant events. Only needs to
	 * be called when a new channel (SID/gsessionid) is opened.
	 *
	 * @return {Promise} [description]
	 *
	 * @rejects {[exceptionType]} If [this condition is met]
	 * @resolves {[exceptionType]} If [this condition is met]
	 */
	async subscribe () {
		if(this.subscribed)
			return

		this.subscribed = true

		// https://github.com/tdryer/hangups/issues/58
		await sleep(1000)

		var timestamp = Date.now() * 1000
		var opts = {
			method: 'POST',
			qs: {
				VER: 8,
				RID: 81188,
				ctype: 'hangouts',
				gsessionid: this.gsid,
				SID: this.sid
			},
			headers: this.authHeaders(),
			timeout: 30000, // 30 seconds timeout in connect attempt
			formData: {
				count: 3,
				ofs: 0,
				req0_p: '{"1":{"1":{"1":{"1":3,"2":2}},"2":{"1":{"1":3,"2":' +
						`2},"2":"","3":"JS","4":"lcsclient"},"3":${timestamp}` +
						',"4":0,"5":"c1"},"2":{}}',
				req1_p: '{"1":{"1":{"1":{"1":3,"2":2}},"2":{"1":{"1":3,"2":' +
						`2},"2":"","3":"JS","4":"lcsclient"},"3":${timestamp}` +
						`,"4":${timestamp},"5":"c3"},"3":{"1":{"1":"babel"}}}`,
				req2_p: '{"1":{"1":{"1":{"1":3,"2":2}},"2":{"1":{"1":3,"2":' +
						`2},"2":"","3":"JS","4":"lcsclient"},"3":${timestamp}` +
						`,"4":${timestamp},"5":"c4"},"3":{"1":{"1":"hangout_invite"}}}`
			}
		}

		let res = await this.fetch(CHANNEL_URL, opts)

		await res.text()

		if (res.status == 200) {
			debug('subscribed channel')
		}
		else if (isUnknownSID(res)) {
			debug('sid became invalid')
			this.sid = null
			this.gsid = null
			this.subscribed = false
		}
		else {
			throw NetworkError(res)
		}
	}
}

module.exports = Channel
