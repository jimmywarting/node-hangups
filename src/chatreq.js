"use strict"

var ProtoBuf  = require("protobufjs")

var NetworkError = require('./util').NetworkError
var CookieJar    = require('tough-cookie').CookieJar
var ByteBuffer   = ProtoBuf.ByteBuffer

class ChatReq {

	constructor(channel, fetch) {
		this.channel = channel
		this.fetch = fetch
	}

	// does a request against url.
	// contentype is request Content-Type.
	// body is the body which will be JSON.stringify()
	// json is whether we want a result that is json or protojson
	//
	// These cookies are typically submitted:
	// NID, SID, HSID, SSID, APISID, SAPISID
	async baseReq (url, contenttype, body, json, timeout, req_pb, res_pb) {
		var headers, opts

		if(res_pb) json = false

		if (json == null) json = true
		if (timeout == null) timeout = 30000

		headers = this.channel.authHeaders()
		if (!headers)
			throw new Error('No auth headers')

		headers['Content-Type'] = contenttype

		url += '?alt=json&key=AIzaSyAfFJCeph-euFSwtmqFZi0kaKk-cZ5wufM'

		let resType = json
		let res = await this.fetch(url, {
			method: 'POST',
			headers,
			body: Buffer.isBuffer(body) ? body : JSON.stringify(body)
		})

		if( !resType && res.headers.get('content-type').includes('application/json;') )
			resType = 'json'
		else if (!resType)
			resType = 'text'


		let resBody = await res[res_pb ? 'text':'json']()

		if (res.ok)
			return resBody

		throw NetworkError(res)
	}

	// request endpoint by submitting body. json toggles whether we want
	// the result as json or protojson
	req (endpoint, body, json, req_pb, res_pb) {
		var url = `https://clients6.google.com/chat/v1/${endpoint}`

		if (json == null) json = 'json'
		return this.baseReq(url, 'application/json+protobuf', body, json, undefined, req_pb, res_pb)
	}

	// Send a Protocol Buffer formatted chat API request.
	//
	// endpoint (str): The chat API endpoint to use.
	// request_pb: The request body as a Protocol Buffer message.
	// response_pb: The response body as a Protocol Buffer message.
	// throws:
	//     NetworkError: If the request fails.
	//
	async pb_request (endpoint, request_pb, response_pb){
		// TODO: figure out how to get json+protobuf representation
		//       or make x-protobuf to work
		let resBody = await this.base_request(
			`https://clients6.google.com/chat/v1/${endpoint}`,
			'application/x-protobuf', // Request body is Protocol Buffer.
			'proto', // Response body is Protocol Buffer.
			request_pb.encode().buffer.toString()
		)

		return response_pb.decode64(resBody)

		// status = response_pb.response_header.status
		// if (status != hangouts_pb2.RESPONSE_STATUS_OK)
		//     description = response_pb.response_header.error_description
		//     raise exceptions.NetworkError(
		//         'Request failed with status {}: \'{}\''
		//         .format(status, description)
		//     )
	}

	base_request (url, content_type, response_type, data) {
		let headers = Object.assign({
			'content-type': content_type,
			// This header is required for Protocol Buffer responses, which causes
			// them to be base64 encoded:
			'X-Goog-Encode-Response-If-Executable': 'base64'
		}, this.channel.authHeaders())

		// "alternative representation type" (desired response format).
		url += '?alt='+response_type

		return this.fetch(url, {
			method: 'post',
			headers: headers,
			compress: false,
			body: data
		}).then(res => res.text())
	}
}

module.exports = ChatReq
