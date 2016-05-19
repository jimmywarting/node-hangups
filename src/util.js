"use strict"

class NetworkError extends Error {
	constructor (code, message, url) {
		super()
		this.code = code
		this.message = message
		this.url = url
	}
}

module.exports = {

	tryparse: str => {
		try {
			return JSON.parse(str)
		} catch (err) {
			return null
		}
	},

	sleep: time => new Promise(rs => setTimeout(rs, time)),

	/**
	 * Retrieve nested item from object/array
	 * don't work with foo[3] just simply use foo.3
	 *
	 * @param {Object|Array} obj
	 * @param {String} path dot separated
	 * @param {*} def default value ( if result undefined )
	 * @returns {*}
	 */
	oResolve: (obj, path, def) => {
		for( path of path.split('.') ){
			if(!obj || typeof obj !== 'object') return def
			obj = obj[path]
		}

		return obj === undefined ? def : obj
	},

	NetworkError: res => new NetworkError(res.status, res.statusText, res.url)
}