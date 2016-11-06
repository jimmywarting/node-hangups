'use strict'

const
fs           = require('fs'),
log          = require('debug')('hangup:auth'),
NetworkError = require('./util').NetworkError,
promisify    = require('tiny-promisify'),
// this CLIENT_ID and CLIENT_SECRET are whitelisted at google and
// turns up as "iOS device". access can be revoked a this page:
// https://security.google.com/settings/security/permissions
OAUTH2_CLIENT_ID     = '936475272427.apps.googleusercontent.com',
OAUTH2_CLIENT_SECRET = 'KWsJlkaMn1jGLxQpWxMnOox-',

OAUTH2_LOGIN_URL   = 'https://accounts.google.com/o/oauth2/auth?&client_id=936475272427.apps.googleusercontent.com&scope=https%3A%2F%2Fwww.google.com%2Faccounts%2FOAuthLogin&redirect_uri=http%3A%2F%2Flocalhost%3A3000&response_type=code',
OAUTH2_TOKEN_URL   = 'https://accounts.google.com/o/oauth2/token',

MERGE_SESSION      = 'https://accounts.google.com/MergeSession',
MERGE_SESSION_MAIL = 'https://accounts.google.com/MergeSession?service=mail&continue=http://www.google.com&uberauth=',
UBERAUTH           = 'https://accounts.google.com/accounts/OAuthLogin?source=hangups&issueuberauth=1'

class Auth {

	constructor(jar, jarstore, creds, opts, fetch) {
		this.creds = creds
		this.jar = jar
		this.jarstore = jarstore
		this.opts = opts
		this.fetch = fetch
	}

	// get authentication cookies on the form [{key:<cookie name>, value:<value>}, {...}, ...]
	// first checks the database if we already have cookies, or else proceeds with login
	async getAuth() {
		log('getting auth...')

		let cookies = this.fetch.jar.getCookiesSync(OAUTH2_LOGIN_URL)

		if (cookies.length)
			log('using cached cookies')
		else {
			log('proceeding to login')
			await this.login()
		}

		log('getAuth done')
	}

	login() {

		// fetch creds to inspect what we got to work with
		var creds = this.creds()

		if (creds.auth)
			return this.oauthLogin(creds.auth)
		else if (creds.cookies) {
			this.providedCookies(creds.cookies)
			return Promise.resolve()
		}
	}

	// An array of cookie strings to put into the jar
	providedCookies (cookies) {
		for(let cookie of cookies)
			this.fetch.jar.setCookieSync(cookie, OAUTH2_LOGIN_URL)
	}


	async oauthLogin (auth) {

		var atoken
		// load the refresh-token from disk, and if found
		// use to get an authentication token.
		let rtoken = await this.loadRefreshToken()
		if(rtoken)
			atoken = await this.authWithRefreshToken(rtoken)

		// use token from refresh-token. just use it.
		// or no loaded refresh-token. request auth code.
		atoken = atoken || (await this.requestAuthCode(auth))
		// one way or another we have an atoken now

		let res = await this.fetch(UBERAUTH, {
			headers: {Authorization: `Bearer ${atoken}`}
		})

		if(res.status !== 200)
			throw NetworkError(res)

		log('got uberauth')
		let uberauth = await res.text()

		// not sure what this is. some kind of cookie warmup call?
		res = await this.fetch(MERGE_SESSION)
		if(res.status !== 200)
			throw NetworkError(res)

		await this.fetch(MERGE_SESSION_MAIL + uberauth, {redirect: 'manual'})
	}

	loadRefreshToken() {
		var path = this.opts.rtokenpath

		return promisify(fs.readFile)(path, 'utf-8')
		.catch(err => {
			// ENOTFOUND is ok, we just return undefine and deal with
			if (err.code == 'ENOENT')
				return

			throw err
		})
	}

	saveRefreshToken(rtoken) {
		var path = this.opts.rtokenpath

		return promisify(fs.writeFile)(path, rtoken)
	}

	async authWithRefreshToken(rtoken) {
		log('auth with refresh token')

		let res = await this.fetch(OAUTH2_TOKEN_URL, {
			method: 'POST',
			formData: {
				client_id     : OAUTH2_CLIENT_ID,
				client_secret : OAUTH2_CLIENT_SECRET,
				grant_type    : 'refresh_token',
				refresh_token : rtoken
			}
		})

		if (res.status == 200) {
			log('refresh token success')
			return (await res.json()).access_token
		} else {
			log(await res.text())
			throw NetworkError(res)
		}

	}

	// request auth code from user
	async requestAuthCode(auth) {

		let code = await auth()

		let opts = {
			method: 'POST',
			formData: {
				client_id:     OAUTH2_CLIENT_ID,
				client_secret: OAUTH2_CLIENT_SECRET,
				code:          code,
				grant_type:    'authorization_code',
				redirect_uri:  'http://localhost:3000'
			}
		}

		// requesting refresh token
		let res = await this.fetch(OAUTH2_TOKEN_URL, opts)
		if (res.status == 200) {
			log('auth with code success')
			let json = await res.json()

			// save it and then return the access token
			await this.saveRefreshToken(json.refresh_token)

			return json.access_token
		}

		log(await res.text())
		throw NetworkError(res)
	}

	static authStdin() {
		process.stdout.write("\nTo log in, open the following link in a browser" +
			"and paste the provided authorization code below:\n\n")

		process.stdout.write(OAUTH2_LOGIN_URL)

		process.stdout.write("\n\nAuthorization Token: ")
		process.stdin.setEncoding('utf8')

		return new Promise(rs => {
			process.stdin.on('readable', function fn(){
				var chunk = process.stdin.read()
				if (chunk){
					rs(chunk)
					process.stdin.removeListener('on', fn)
				}
			})
		})
	}
}

// Expose this to Client
Auth.prototype.OAUTH2_LOGIN_URL = OAUTH2_LOGIN_URL

module.exports = Auth
