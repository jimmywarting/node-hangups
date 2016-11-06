'use strict'

const
ABORT           = Symbol(),
CookieJar       = require('tough-cookie').CookieJar,
EventEmitter    = require('events'),
fs              = require('fs'),
debug           = require('debug')('hangup:client'),
promisify       = require('tiny-promisify'),
syspath         = require('path'),

fetch           = require('./fetch'),
root            = require('./proto'),
MessageBuilder  = require('./messagebuilder'),
MessageParser   = require('./messageparser'),
ChatReq         = require('./chatreq'),
Channel         = require('./channel'),
Auth            = require('./auth'),
schema          = require('./schema'),
sleep           = require('./util').sleep,

OffTheRecordStatus = schema.OffTheRecordStatus,
TypingStatus = schema.TypingStatus,
ClientDeliveryMediumType = schema.ClientDeliveryMediumType,
ClientNotificationLevel = schema.ClientNotificationLevel,
CLIENT_SYNC_ALL_NEW_EVENTS_RESPONSE = schema.CLIENT_SYNC_ALL_NEW_EVENTS_RESPONSE,
CLIENT_GET_CONVERSATION_RESPONSE = schema.CLIENT_GET_CONVERSATION_RESPONSE,
CLIENT_GET_ENTITY_BY_ID_RESPONSE = schema.CLIENT_GET_ENTITY_BY_ID_RESPONSE,
IMAGE_UPLOAD_URL = 'https://docs.google.com/upload/photos/resumable',

// the max amount of time we will wait between seeing some sort of
// activity from the server.
ALIVE_WAIT = 45000,
DEFAULTS = {
	rtokenpath:  syspath.normalize(syspath.join(__dirname, '../refreshtoken.txt')),
	cookiespath: syspath.normalize(syspath.join(__dirname, '../cookies.json'))
};

fs.unlinkAsync = promisify(fs.unlink)
fs.statAsync = promisify(fs.stat)
fs.readFileAsync = promisify(fs.readFile)

// ensure path exists
var touch = path => {
	try {
		fs.statSync(path)
	} catch (err) {
		if (err.code === 'ENOENT') {
			fs.writeFileSync(path, '')
		}
	}
}

var randomid = () => Math.round(Math.random() * Math.pow(2,32))
var datetolong = d => d instanceof Date ? d.getTime() : d
var togoogtime = d => (datetolong(d) * 1000).toFixed(0)
var rm = path => unlinkAsync(path).catch(err =>
	err.code == 'ENOENT' ? null : Promise.reject(err))

class Client extends EventEmitter {

	constructor (opts) {
		super()
		this.opts = Object.assign({}, DEFAULTS, opts)

		touch(this.opts.cookiespath)

		this.jar = new CookieJar()
		this.fetch = fetch(this.jar)

		// Need to fix long poll before removing it completly
		this.channel = new Channel(this.jarstore, this.fetch)
		this.chatreq = new ChatReq(this.channel, this.fetch)
		this.messageParser = new MessageParser(this)

		// clientid comes as part of pushdata
		this.on('clientid', clientid => this._clientid = clientid)
	}

	logLevel (lvl) {
		log.level(lvl)
	}

	// Do we dear to change this promise change to awaits?
	// catch can throw for many diffrent reason...
	async connect (creds) {
	    // tell the world what we're doing
        this.emit('connecting')
        // create a new auth instance
        this.auth = new Auth(this.jar, this.jarstore, creds, this.opts, this.fetch)
        // getAuth does a login and stores the cookies
        // of the login into the db. the cookies are
        // cached.
        await this.auth.login()
        this.running = true
        this.connected = false
        // ensure we have a fresh timestamp
        this.lastActive = Date.now()
        this.ensureConnected()

        var poller = () => {
            if(!this.running)
            	return

            this.channel.getLines().then(lines => {
                // wait until we receive first data to emit a
                // 'connected' event.
                if (!this.connected && this.running) {
                    this.connected = true
                    this.emit('connected')
                }

                // when disconnecting, no more lines to parse.
                if (this.running) {
                    this.messageParser.parsePushLines(lines)
                    poller()
                }
            })
            .catch(err => {
            	log(err)
                log('poller stopped')
                this.running = false
                this.connected = false
                this.emit('connect_failed', err)
            })
        }

        poller()
	}

	emit (ev, data) {
		// record when we last emitted
		if(ev !== 'connect_failed')
			this.lastActive = Date.now()

		// and do it
		super.emit(ev, data)
	}


	// we get at least a "noop" event every 20-30 secs, if we have no
	// event after 45 secs, we must suspect a network interruption
	async ensureConnected () {

		// and no ensuring unless we're connected
		while (this.running) {
			// check whether we got an event within the threshold we see
			// noop 20-30 secs, so 45 should be ok
			if ( ALIVE_WAIT < Date.now() - this.lastActive) {
				debug('activity wait timeout after 45 secs')
				this.disconnect() // this also sets this.connected to false
				this.emit('connect_failed', new Error("Connection timeout"))
				return
			}

			let waitFor = this.lastActive + ALIVE_WAIT - Date.now()
			await sleep(waitFor)
		}

	}



	/**
	 * Gracefully disconnect from the server.
	 * When disconnection is complete, Client.connect will return.
	 * @return {[type]} [description]
	 */
	disconnect () {
    log.info('Disconnecting gracefully...')
		debug('disconnect')
		this.running = false
		this.connected = false
		clearTimeout(this.ensureTimer)
		return this.channel.stop()
	}




	/**
	 * Makes the header required at the start of each api call body.
	 * Why do we even call this?
	 *
	 * @return {Array} headers
	 */
	_requestBodyHeader() {
		return [
			[undefined, undefined, '0.3.5', undefined],
			[this._clientid],
			undefined,
			"en"
		]
	}


    /**
     * Set this client as active.
	 *
     * @param  {Boolean} active      boolean indicating active state
     * @param  {Number}  timeoutsecs The length of active in seconds.
     * @param  {String}  email       Should be your own email adress
     * @return {Promise}             Resolves void on success or throws
     */
	setActiveClient (active, timeoutsecs, email) {
		return this.chatreq.req('clients/setactiveclient', [
			this._requestBodyHeader(),
			active,
			`${email}/${this._clientid}`,
			timeoutsecs
		])
	}


	// List all events occuring at or after timestamp. Timestamp can be
	// a date or long millis.
	//
	// This method requests protojson rather than json so we have one
	// chat message parser rather than two.
	//
	// timestamp: date instance specifying the time after which to
	// return all events occuring in.
	//
	// returns a parsed CLIENT_SYNC_ALL_NEW_EVENTS_RESPONSE
	syncAllNewEvents (timestamp) {
		return this.chatreq.req('conversations/syncallnewevents', [
			this._requestBodyHeader(),
			togoogtime(timestamp),
			[], undefined, [], false, [],
			1048576 // max_response_size_bytes
		])
	}



	// Send a chat message to a conversation.
	//
	// conversation_id must be a valid conversation ID. segments must be a
	// list of message segments to send, in pblite format.
	//
	// image_id is an optional ID of an image retrieved from
	// this.uploadimage(). If provided, the image will be attached to the
	// message.
	//
	// otr_status determines whether the message will be saved in the server's
	// chat history. Note that the OTR status of the conversation is
	// irrelevant, clients may send messages with whatever OTR status they
	// like.
	//
	// client_generated_id is an identifier that is kept in the event
	// both in the result of this call and the following chat_event.
	// it can be used to tie together a client send with the update
	// from the server. The default is `null` which makes
	// the client generate a random id.
	sendChatMessage (conversation_id, segments, image_id,
		otr_status, client_generated_id, delivery_medium, attachment
	) {
		client_generated_id = client_generated_id || randomid()

		return this.chatreq.req('conversations/sendchatmessage', [
			this._requestBodyHeader(),
			undefined, undefined, undefined, [],
			[ segments, []],
			(image_id ? [[image_id, false]] : undefined),
			[
				[conversation_id],
				client_generated_id || null,
				otr_status || OffTheRecordStatus.ON_THE_RECORD,
				delivery_medium || [ClientDeliveryMediumType.BABEL]
			]
		])
	}


	// Return information about your account.
	getSelfInfo () {
		return this.chatreq.req('contacts/getselfinfo', [
			this._requestBodyHeader(),
			[], []
		])
	}

	// Set focus (occurs whenever you give focus to a client).
	setFocus (conversation_id) {
		return this.chatreq.req('conversations/setfocus', [
			this._requestBodyHeader(),
			[conversation_id],
			1,
			20
		])
	}

	// Send typing notification.
	//
	// conversation_id must be a valid conversation ID. typing must be
	// a TypingStatus enum.
	setTyping (conversation_id, typing) {
		return this.chatreq.req('conversations/settyping', [
			this._requestBodyHeader(),
			[conversation_id],
			typing || TypingStatus.TYPING
		])
	}

	// Set the presence or mood of this client.
	setPresence (online, mood) {
		return this.chatreq.req('presence/setpresence', [
			this._requestBodyHeader(),
			[
				// timeout_secs timeout in seconds for this presence
				720,
				// client_presence_state:
				// 40 => DESKTOP_ACTIVE
				// 30 => DESKTOP_IDLE
				// 1 => undefined
				online ? 1 : 40
			],
			undefined,
			undefined,
			// true if going offline, false if coming online
			[!online],
			// UTF-8 smiley like 0x1f603
			[mood]
		])
	}

	// Check someone's presence status.
	queryPresence (chat_id) {
		return this.chatreq.req('presence/querypresence', [
			this._requestBodyHeader(),
			[ [chat_id] ],
			[1, 2, 5, 7, 8]
		])
	}

	// Leave group conversation.
	//
	// conversation_id must be a valid conversation ID.
	removeUser (conversation_id) {
		let client_generated_id = randomid()
		return this.chatreq.req('conversations/removeuser', [
			this._requestBodyHeader(),
			undefined, undefined, undefined,
			[
				[conversation_id], client_generated_id, 2
			]
		])
	}

	// Delete one-to-one conversation.
	//
	// conversation_id must be a valid conversation ID.
	deleteConversation (conversation_id) {
		return this.chatreq.req('conversations/deleteconversation', [
			this._requestBodyHeader(),
			[conversation_id],
			// Not sure what timestamp should be there, last time I have tried it
			// Hangouts client in GMail sent something like now() - 5 hours
			Date.now() * 1000,
			undefined, [],
		])
	}

	// Update the watermark (read timestamp) for a conversation.
	//
	// conversation_id must be a valid conversation ID.
	//
	// timestamp is a date or long millis
	updateWatermark (conversation_id, timestamp) {
		return this.chatreq.req('conversations/updatewatermark', [
			this._requestBodyHeader(),
			// conversation_id
			[conversation_id],
			// latest_read_timestamp
			togoogtime(timestamp)
		])
	}

	// Add user to existing conversation.
	//
	// conversation_id must be a valid conversation ID.
	//
	// chat_ids is an array of chat_id which should be invited to
	// conversation.
	addUser (conversation_id, chat_ids) {
		let client_generated_id = randomid()
		return this.chatreq.req('conversations/adduser', [
			this._requestBodyHeader(),
			undefined,
			chat_ids.map(chat_id =>
				[chat_id, undefined, undefined, "unknown", undefined, []]
			),
			undefined,
			[
				[conversation_id], client_generated_id, 2, undefined, 4
			]
		])
	}

	// Set the name of a conversation.
	renameConversation (conversation_id, name) {
		let client_generated_id = randomid()
		return this.chatreq.req('conversations/renameconversation', [
			this._requestBodyHeader(),
			undefined,
			name,
			undefined,
			[[conversation_id], client_generated_id, 1]
		])
	}

	// Create a new conversation.
	//
	// chat_ids is an array of chat_id which should be invited to
	// conversation (except yourself).
	//
	// force_group set to true if you invite just one chat_id, but
	// still want a group.
	//
	// New conversation ID is returned as res['conversation']['id']['id']
	createConversation (chat_ids, force_group, name) {
		var client_generated_id = randomid()

		// return [
		// [6, 3, this.init.headerversion, this.init.headerdate],
		// [this.init.clientid, this.init.headerid],
		// undefined,
		// "en"]

		// let request_pb = new root.CreateConversationRequest({
		// 	request_header: new root.RequestHeader({
		// 		client_version: new root.ClientVersion({
		// 			client_id: 6,
		// 			build_type: 3,
		// 			major_version: this.init.headerversion,
		// 			version_timestamp: this.init.headerdate
		// 		}),
		// 		client_identifier: new root.ClientIdentifier({
		// 			resource: this.init.clientid,
		// 			header_id: this.init.headerid
		// 		}),
		// 		language_code: "en"
		// 	}),
		// 	type: !force_group ? 1 : 2,
		// 	name: name,
		// 	client_generated_id: client_generated_id,
		// 	invitee_id: chat_ids.map(gaia_id => new root.InviteeID({gaia_id, fallback_name: 'unknown'}))
		// })

		// let response_pb = root.CreateConversationResponse

		// return this.chatreq.pb_request('conversations/createconversation', request_pb, response_pb, [
		// 	this._requestBodyHeader(),
		// 	chat_ids.length == 1 && !force_group ? 1 : 2,
		// 	client_generated_id,
		// 	undefined,
		// 	chat_ids.map(chat_id =>
		// 		[chat_id, undefined, undefined, "unknown", undefined, []]
		// 	)
		// ])

		return this.chatreq.req('conversations/createconversation', [
			this._requestBodyHeader(),
			chat_ids.length == 1 && !force_group ? 1 : 2,
			client_generated_id,
			name,
			chat_ids.map(chat_id =>
				[chat_id, undefined, undefined, "unknown", undefined, []]
			)
		])
	}

	// Return conversation events.
	//
	// This is mainly used for retrieving conversation
	// scrollback. Events occurring before timestamp are returned, in
	// order from oldest to newest.
	async getConversation (conversation_id, timestamp, max_events) {
		let body = await this.chatreq.req('conversations/getconversation', [
			this._requestBodyHeader(),
			[[conversation_id], [], []],  // conversationSpec
			false,                        // includeConversationMetadata
			true,                         // includeEvents
			undefined,                    // ???
			max_events || 50,             // maxEventsPerConversation
			// eventContinuationToken (specifying timestamp is sufficient)
			[
				undefined,  // eventId
				undefined,  // storageContinuationToken
				togoogtime(timestamp),  // eventTimestamp
			]
		])

		return CLIENT_GET_CONVERSATION_RESPONSE.parse(body)
	}


	// List the contents of recent conversations, including messages.
	// Similar to syncallnewevents, but appears to return a limited
	// number of conversations (20) rather than all conversations in a
	// given date range.
	//
	// returns a parsed CLIENT_SYNC_ALL_NEW_EVENTS_RESPONSE (same structure)
	async syncRecentConversations() {
		let body = await this.chatreq.req('conversations/syncrecentconversations', [
			this._requestBodyHeader()
		])

		return CLIENT_SYNC_ALL_NEW_EVENTS_RESPONSE.parse(body)
	}

	// Search for people.
	searchEntities (search_string, max_results) {
		// var request_pb = new root.SearchEntitiesRequest({})
		// return this.chatreq.post('contacts/searchentities', [
		return this.chatreq.req('contacts/searchentities', [
			this._requestBodyHeader(),
			[],
			search_string,
			max_results || 10
		], 'json')
	}



	/**
	 * Return information about a list of chat_ids
	 *
	 * @param  {[type]} chat_ids [description]
	 * @return {Promise}          [description]
	 */
	async getEntityById (chat_ids) {
		let body = await this.chatreq.req('contacts/getentitybyid', [
			this._requestBodyHeader(),
			undefined,
			chat_ids
		], false)
		return CLIENT_GET_ENTITY_BY_ID_RESPONSE.parse(body)
	}

	// Send a easteregg to a conversation.
	//
	// easteregg may not be empty. should be one of
	// 'ponies', 'pitchforks', 'bikeshed', 'shydino'
	sendEasteregg (conversation_id, easteregg) {
		return this.chatreq.req('conversations/easteregg', [
			this._requestBodyHeader(),
			[conversation_id],
			[easteregg, undefined, 1]
		])
	}

	// Set the notification level of a conversation.
	//
	// Pass Client.NotificationLevel.QUIET to disable notifications,
	// or Client.NotificationLevel.RING to enable them.
	setConversationNotificationLevel (conversation_id, level) {
		return this.chatreq.req('conversations/setconversationnotificationlevel', [
			this._requestBodyHeader(),
			[conversation_id],
			level
		])
	}


	/**
	 * Uploads an image that can be later attached to a chat message.
	 * Only supported formats is JPG, PNG, GIF, BMP, WEBP and TIFF.
	 *
	 * @param  {String} imageFile Path to the file to upload
	 * @param  {String} fileName  Defaults to imageFile's basename
	 * @param  {Number} timeout   When we should cancle
	 * @return {Number}           photo id that can be attached to a msg
	 */
	async uploadImage (imageFile, fileName, timeout) {
		// either use provided or from path
		fileName = fileName || syspath.basename(imageFile)
		var size
		var puturl
		var chatreq = this.chatreq

		// figure out file size
		size = (await fs.statAsync(imageFile)).size
		debug('image resume upload prepare')

		let body = await chatreq.baseReq(IMAGE_UPLOAD_URL, 'application/x-www-form-urlencoded;charset=UTF-8' , {
			protocolVersion: "0.8",
			createSessionRequest: {
				fields: [{
					external: {
						fileName,
						size,
						put: {},
						name: 'file'
					}
				}]
			}
		})

		puturl = body.sessionStatus.externalFieldTransfers[0].putInfo.url
		debug('image resume upload to:', puturl)

		let buf = await fs.readFileAsync(imageFile)

		debug('image resume uploading')
		body = await chatreq.baseReq(puturl, 'application/octet-stream', buf, true, timeout || 30000)

		debug('image resume upload finished')
		return body.sessionStatus.additionalInfo['uploader_service.GoogleRupioAdditionalInfo'].completionInfo.customerSpecificInfo.photoid
	}

}

// Expose these as part of publich API
Client.OffTheRecordStatus = OffTheRecordStatus
Client.TypingStatus = TypingStatus
Client.MessageBuilder = MessageBuilder
Client.authStdin = Auth.authStdin
Client.NotificationLevel = ClientNotificationLevel
// Client.OAUTH2_LOGIN_URL = Auth.OAUTH2_LOGIN_URL

module.exports = Client
