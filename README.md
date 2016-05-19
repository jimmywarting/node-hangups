hangupsjs
=========

[![Gitter](https://badges.gitter.im/jimmywarting/node-hangups.svg)](https://gitter.im/jimmywarting/node-hangups?utm_source=badge&utm_medium=badge&utm_campaign=pr-badge)

## Summary

Client library for Google Hangouts in build for NodeJS.

## Origins

Port of https://github.com/tdryer/hangups to node js.

I take no credit for the excellent work of Tom Dryer putting together
the original python client library for Google Hangouts.

The library is rather new and needs more tests, error handling etc.

## Usage

```bash
$ npm install node-hangups --save
```

The client is started with `connect()` passing callback function for a
promise for a login object containing the credentials.

Example usage

```javascript
const Hangups = require('node-hangups');

// callback to get promise for creds using stdin. this in turn
// means the user must fire up their browser and get the
// requested token.
const creds = () => ({
	auth: Client.authStdin
})

const client = new Hangups()

// receive chat message events
client.on('chat_message', evt => {
    console.log(evt)
})

// connect and post a message.
// the id is a conversation id.
client.connect(creds).then(() => {
    client.sendchatmessage('UgzJilj2Tg_oqkAaABAQ', [[0, 'Hello World']])
})
```

## Long running sessions / reconnect

hangups will not try to keep the connection open endlessly. The push
channel has some reconnect logic, but it will eventually back off with
a `connect_failed` event.

additionally the client also monitors activity. the push channel
receives events at least every 20-30 seconds, if there are no chat
events, we get a `noop`.

after a successful `connect()`, the client monitors the channel to
ensure we receive any event at least every 45 seconds. if 45 seconds
passes and the push channel got nothing, the client stops with a
`connect_failed` event.

### Example

To construct a client that just doesn't give up we do:

```javascript
function reconnect() {
    client.connect(creds).then(() => {
        // we are now connected. a `connected`
        // event was emitted.
    })
}

// whenever it fails, we try again
client.on('connect_failed', () => {
    setTimeout(reconnect, 3000)
})

// start connection
reconnect()
```

## API

### High Level API

High level API calls that are not doing direct hangouts calls.

#### `Client()`

`connect: (creds)`

Attempts to connect the client to hangouts. See
[`isInited`](#isinited) for the steps that connects the client.
Returns a promise for connection. The promise only resolves when init
is completed. On the [`connected`](#connected) event.

`creds`: is callback that returns a promise for login creds. The creds
are either `{creds:-><promise for token>}` or
`{cookies:<array of strings or tough-cookie-jar>}`

##### email/pass

To login using an email/password combo, you need to login using OAuth
and provide the access token to the API. Furthermore it uses a google
white listed OAuth CLIENT\_ID and CLIENT\_SECRET that shows up as
"iOS Device" in your accounts page.

This is the login URL, also available as `Client.OAUTH2_LOGIN_URL`.

https://accounts.google.com/o/oauth2/auth?&client_id=936475272427.apps.googleusercontent.com&scope=https%3A%2F%2Fwww.google.com%2Faccounts%2FOAuthLogin&redirect_uri=urn%3Aietf%3Awg%3Aoauth%3A2.0%3Aoob&response_type=code

The library provides a stdin-method that requests the token.

```javascript
let creds = () => ({auth: Client.authStdin})

client.connect(creds).then(() => { /* and so on */ })
```

##### cookies

The other way to log in is to provide a string array of cookies for
the `google.com` domain that are set up as part of a successful login.

Typically these cookies are called: `NID`, `SID`, `HSID`, `SSID`,
`APISID`, `SAPISID`

Example:

```javascript
let creds = () => ({
	cookies: [
	    'NID=67=QI6go9WM<redacted>WDFxv; Expires=Wed, 04 Nov 2015 06:10:24 GMT; Domain=google.com; Path=/; HttpOnly'
	    'SID=DASDPgAAA<redacted>AKJASKJD; Expires=Thu, 04 May 2017 06:10:24 GMT; Domain=google.com; Path=/'
	    'HSID=AR<redacted>QX_; Expires=Thu, 04 May 2017 06:10:24 GMT; Domain=google.com; Path=/; HttpOnly; Priority=HIGH'
	    'SSID=Ak<redacted>D; Expires=Thu, 04 May 2017 06:10:24 GMT; Domain=google.com; Path=/; Secure; HttpOnly; Priority=HIGH'
	    'APISID=kM<redacted>seXb; Expires=Thu, 04 May 2017 06:10:24 GMT; Domain=google.com; Path=/; Priority=HIGH'
	    'SAPISID=cl<redacted>Od; Expires=Thu, 04 May 2017 06:10:24 GMT; Domain=google.com; Path=/; Secure; Priority=HIGH'
    ]
})

client.connect(creds).then(() => { /* and so on */ })
```


#### `disconnect`

`client.disconnect()`

Disconnects the client.


#### `logout`

`logout: ()`

Logs the current client out by removing refresh token and cached cookies.

Example:

#### `MessageBuilder`

Helper to compose message `segments` that goes into
[`sendchatmessage`](#sendchatmessage). The builder has these methods.

Example:

```javascript
let bld = new Client.MessageBuilder()
let segments = bld.text('Hello ').bold('World').text('!!!').toSegments()
client.sendchatmessage(conversationId, segments)
```

##### `builder.text(txt)`

`(txt, bold=false, italic=false, strikethrough=false, underline=false, href=null)`

Adds a text segment.

```javascript
builder.text('Hello')
```

##### `builder.bold(txt)`

Adds a text segment in bold.

##### `builder.italic(txt)`

Adds a text segment in italic.

##### `builder.strikethrough(txt)`

Adds a text segment strikethroughed.

##### `builder.underline(txt)`

Adds an underlined text segment.

##### `build.linebreak()`

Adds a new line.

##### `builder.link(txt, href)`

Adds a text that is a link.

##### `builder.toSegments`

Turns the builder into an array of segments usable for [`sendChatMessage`](#sendChatMessage).

--------------

### Low Level API

Each API call does a direct operation against hangouts. Each call
returns a promise for the result.

#### `sendChatMessage`

```javascript
client.sendChatMessage(conversationId, segments, image_id,
	otr_status, client_generated_id, delivery_medium, attachment)
```

Send a chat message to a conversation.

`conversationId`: the conversation to send a message to.

`segments`: array of segments to send. See
[`messagebuilder`](#messagebuilder) for help.

`image_id`: is an optional ID of an image retrieved from
[`uploadimage`](#uploadimage). If provided, the image will be
attached to the # message.

`otr_status`: determines whether the message will be saved in the
server's chat history. Note that the OTR status of the conversation is
irrelevant, clients may send messages with whatever OTR status they
like. One of `Client.OffTheRecordStatus.OFF_THE_RECORD` or
`Client.OffTheRecordStatus.ON_THE_RECORD`.

`client_generated_id` is an identifier that is kept in the event both
in the result of this call and the following chat_event.  it can be
used to tie together a client send with the update from the
server. The default is `null` which makes the client generate a random
id.

`delivery_medium`: determines via which medium the message will be
delivered. If caller does not specify value we pick the value BABEL to
ensure the message is delivered via default medium. In fact the caller
should retrieve current conversation's default delivery medium from
self_conversation_state.delivery_medium_option when calling to ensure
the message is delivered back to the conversation on same medium always.

#### `setActiveClient`

`client.setActiveClient(active, timeoutsecs)`

The active client receives notifications. This marks the client as active.

`active`: boolean indicating active state

`timeoutsecs`: the length of active in seconds.



#### `syncallnewevents`

`syncAllNewEvents(timestamp).then(success)`

List all events occuring at or after timestamp. Timestamp can be a
date or long millis.

`timestamp`: date instance specifying the time after which to return
all events occuring in.



#### `getSelfInfo`

`getSelfInfo:`

Return information about your account.



#### `setConversationNotificationLevel`

`setConversationNotificationLevel(conversationId, level).then(result)`

Set the notification level of a conversation.

Pass `Client.NotificationLevel.QUIET` to disable notifications, or
`Client.NotificationLevel.RING` to enable them.



#### `setFocus`

`setFocus(conversationId).then()`

Set focus (occurs whenever you give focus to a client).

`conversationId`: the conversation you are focusing.



#### `setTyping`

`setTyping(conversationId, typing=TypingStatus.TYPING)`

Send typing notification.

`conversationId`: the conversation you want to send typing
notification for.

`typing`: constant indicating typing status. One of
`Client.TypingStatus.TYPING`, `Client.TypingStatus.PAUSED` or
`Client.TypingStatus.STOPPED`



#### `setpresence`

`setpresence(online, [, mood])`

Set the presence or mood of this client.

`online`: boolean indicating whether client is online.

`mood`: emoticon UTF-8 smiley like 0x1f603



#### `queryPresence`

`queryPresence(chatId)`

Check someone's presence status.

`chatId`: the identifer of the user to check.



#### `removeUser`

`removeUser(conversationId)`

Remove self from chat.

`conversationId`: the conversation to remove self from.



#### `deleteConversation`

`deleteconversation(conversationId)`

Delete one-to-one conversation.

`conversationId`: the conversation to delete.



#### `updateWatermark`

`updateWatermark(conversationId, timestamp)`

Update the watermark (read timestamp) for a conversation.

`conversationId`: the conversation to update the read timestamp for.

`timestamp`: the date or long millis to set as read timestamp.



#### `addUser`

`addUser(conversationId, chatIds)`

Add user(s) to existing conversation.

`conversationId`: the conversation to add user(s) to.

`chatIds`: array of user chat_ids to add.



#### `renameConversation`

`renameConversation(conversationId, name)`

Set the name of a conversation.

`conversationId`: the conversation to change.

`name`: the name to change to.



#### `createConversation`

`createConversation(chatIds, [, forceGroup=false])`

Create a new conversation.

`chatIds`: is an array of chat_id which should be invited to
conversation (except yourself).

`forceGroup`: set to true if you invite just one chat_id, but still
want a group.

The new conversation ID is returned as `res.conversation.id.id`



#### `getConversation`

`getConversation(conversationId, timestamp [, maxEvents=50])`

Return conversation events.

This is mainly used for retrieving conversation scrollback. Events
occurring before timestamp are returned, in order from oldest to
newest.

`conversationId`: the conversation to get events in.

`timestamp`: the timestamp as long millis or date to get events
before.

`maxEvents`: number of events to retrieve.



#### `syncRecentConversations`

`syncRecentConversations:`

List the contents of recent conversations, including messages.
Similar to syncallnewevents, but appears to return a limited number of
conversations (20) rather than all conversations in a given date
range.



#### `searchentities`

`searchentities(searchString [, maxResults=10])`

Search for people.

`searchString`: string to look for.

`maxResults`: number of results to return.



#### `getEntityById`

`getEntityById(chatIds)`

Return information about a list of chat_ids.

`chatIds`: array of user chat ids to get information for.



#### `sendEasterEgg`

`sendEasterEgg(conversationId, easteregg)`

Send an easteregg to a conversation.

`conversationId`: conversation to bother.

`easteregg`: may not be empty. could be one of 'ponies', 'pitchforks',
'bikeshed', 'shydino'



#### `uploadImage`

`uploadImage(path [, filename=null, timeout=30000])`

Uploads an image that can be later attached to a chat message.

`imagefile` is a string path

`filename` can optionally be provided otherwise the path name is used.

`timeout` can be used to upload larger images, that may need more than 30 sec to be sent

returns an `image_id` that can be used in [`sendchatmessage`](#sendchatmessage).



## Events

The following events are available on the `Client` object. Example:

```javascript
client.on('chat_message', msg => {
	console.log(msg)
})
```

### State events

#### `connecting`

When someone calls `client.connect()` and it indicates we are trying
to connect the client.

#### `connected`

When the client is fully inited and connected.

#### `connect_failed (err)`

Indicates that the client connection either didn't start or was
interrupted. Either way, the client will not try to connect again by
itself.  Another `client.connect` is required.

Emitted in three cases.

1. After `connecting` (in `client.connect()`) indicating that the
client could not connect at all.

2. After `connected` when running the polling (server push channel)
successfully, but is interrupted (such as lost network connection).

3. If the server push channel receives no events after 45 seconds
   (server emits at least `noop` every 20-30 seconds).

### Chat events

#### `chat_message`

On a received chat message.

#### `client_conversation`

Whenever an update about the conversation itself is needed. Like when
a new conversation is created, this event comes first with the
metadata about it.

The conversation state is stored in self_conversation_state of the event.
The self_conversation_state.delivery_medium_option contains an array of the
delivery medium options which indicate all possible medium. The array element
with current_default == true should be the one used to send message via by
default. Currently there are 3 types of known medium, BABEL, Google Voice and
SMS. BABEL is the Google Hangouts codename BTW.

#### `membership_change`

Member joining/leaving conversation.

#### `conversation_rename`

On a renamed conversation.

#### `focus`

When a user focuses a conversation.

#### `hangout_event`

On changes to video/audio calls. A "hangout" is in google API talk
strictly a video/audio event. `START_HANGOUT` and `END_HANGOUT` would
indicate attempts to start/end audio/video events.

#### `typing`

When a user is typing.

#### `watermark`

When a user updates their read timestamp.

#### `notification_level`

When user changes the notification level of his own
conversation. I.e. [setConversationNotificationLevel](#setConversationNotificationLevel).

#### `easter_egg`

When anyone in the conversation triggers an easter
egg.

#### `delete`

When a conversation is deleted by the user. As a response
to `deleteconversation`.
