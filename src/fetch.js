"use strict"

var log             = require('debug')('hangup:fetch')
var tough           = require('tough-cookie')
var fetch           = require('node-fetch')
var URLSearchParams = require('urlsearchparams').URLSearchParams
var FormData        = require('form-data')
var Request         = fetch.Request

module.exports = function fetchCookieDecorator(jar) {

	jar = jar || new tough.CookieJar()

	function fetch_extended(url, opts) {
		opts = opts || {}

		if(opts.qs) {
			if(url.includes('?'))
				throw new Error('need to make fetch a bit more smarter')

			let qs = new URLSearchParams();

			for (let key in opts.qs) {
				qs.append(key, opts.qs[key])
			}

			url += '?' + qs
		}

		if(opts.formData) {
			let fd = new FormData()
			for(let key in opts.formData)
				fd.append(key, opts.formData[key])

			opts.body = fd
			delete opts.formData
		}

		var cookie = jar.getCookieStringSync(url)

		return fetch(url, Object.assign(opts, {
			headers: Object.assign(opts.headers || {}, { cookie: cookie })
		}))
		.then(res => {
			log(`${res.status} ${(opts.method || ' get').toUpperCase()} ${url} `)
			let cookies = res.headers.getAll('set-cookie')

			for(let cookie of cookies)
				jar.setCookieSync(cookie, res.url)

			return res
		})
	}

	fetch_extended.jar = jar

	return fetch_extended
}
