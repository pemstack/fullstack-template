/* eslint-disable eqeqeq */

import { Action } from '@pema/state'
import { App, isErrorCode } from 'app'
import wretch from 'wretch'
import * as yup from 'yup'

const api = wretch('/api/auth')

export interface TokenResponse {
  accessToken: string
  sessionId: string
  persist: boolean
}

const loginSchema = yup.object({
  username: yup.string().required(),
  password: yup.string().required(),
  persist: yup.boolean().notRequired()
})

const tokenSchema = yup.object({
  persist: yup.boolean().notRequired()
})

export type LoginParams = yup.InferType<typeof loginSchema>
export type TokenParams = yup.InferType<typeof tokenSchema>

const LOGIN: Action<LoginParams, TokenResponse> = {
  schema: loginSchema,
  async perform(params: LoginParams) {
    return await api
      .url('/login')
      .post(params, { credentials: 'omit' })
      .json()
  }
}

const TOKEN: Action<TokenParams, TokenResponse> = {
  schema: tokenSchema,
  async perform(params: LoginParams) {
    return await api
      .url('/token')
      .post(params, { credentials: 'same-origin' })
      .json()
  }
}

const SYNCHRONIZE_INTERVAL = 10

interface UserSession {
  accessToken: string | null
  sessionId: string
  persist: boolean
}

export class UserStore {
  private readonly app: App

  private intervalId: any
  private session: UserSession | null

  private getSessionId() {
    return this.app.cookies.get('sessionId')
  }

  private updateSession(sessionId: string | null | undefined) {
    if (sessionId) {
      this.session = {
        accessToken: null,
        sessionId,
        persist: true
      }
    } else {
      this.session = null
    }
  }

  private synchronize() {
    const cached = this.sessionId
    const current = this.getSessionId()
    // tslint:disable-next-line: triple-equals
    if (cached != current) {
      // Session changed from other window
      this.updateSession(current)
      this.app.apiClient.invalidate('*', false)
      document.location.reload()
      return true
    }

    return false
  }

  private setInterval() {
    if (this.intervalId) {
      clearInterval(this.intervalId)
    }

    this.intervalId = setInterval(() => {
      this.synchronize()
    }, SYNCHRONIZE_INTERVAL * 1000)
  }

  private async refresh(synchronize = true, persist = true) {
    if (synchronize && this.synchronize()) {
      throw new Error()
    }

    const sessionId = this.getSessionId()
    if (!sessionId) {
      this.session = null
      return null
    }

    this.setInterval()
    try {
      const session = await this.app.apiClient.action(TOKEN, { persist })
      if (session.sessionId !== sessionId) {
        throw new Error('Unexpected session change.')
      }

      this.session = session
      return session
    } catch (error) {
      if (isErrorCode(401, error)) {
        this.session = null
        return null
      } else {
        this.updateSession(sessionId)
        throw error
      }
    }
  }

  constructor(state: any, app: App) {
    this.app = app
    this.session = null
    this.setInterval()
  }

  initialize() {
    const sessionId = this.getSessionId()
    this.updateSession(sessionId)
    this.getAccessToken().catch(console.error)
  }

  get authenticated() {
    return !!this.session
  }

  get sessionId() {
    return this.session ? this.session.sessionId : null
  }

  request = wretch()
    .options({ credentials: 'omit' })
    .middlewares([next => async (url, opts) => {
      const token = await this.getAccessToken()
      if (token) {
        return next(url, {
          ...opts,
          headers: {
            ...opts.headers || {},
            Authorization: 'Bearer ' + token
          }
        })
      } else {
        return next(url, opts)
      }
    }])
    .catcher(401, async (error, request) => {
      if (!this.authenticated) {
        throw error
      }

      const token = await this.getAccessToken(true)
      if (!token) {
        throw error
      }

      return request
        .auth('Bearer ' + token)
        .replay()
        .unauthorized(err => { throw err })
        .json()
    })

  private refreshTask: null | Promise<TokenResponse | null>
  async getAccessToken(refresh = false): Promise<string | null> {
    if (!this.session) {
      return null
    }

    if (!refresh && this.session.accessToken) {
      return this.session.accessToken
    }

    let session: TokenResponse | null
    if (this.refreshTask) {
      session = await this.refreshTask
    } else {
      const task = this.refresh()
      this.refreshTask = task
      try {
        session = await task
      } finally {
        this.refreshTask = null
      }
    }

    return session ? session.accessToken : null
  }

  async login(params: LoginParams) {
    const { apiClient } = this.app
    const session = await apiClient.action(LOGIN, params)
    this.session = session
    apiClient.invalidate('*', false)
    this.setInterval()
    return session
  }

  logout() {
    this.session = null
    const { cookies, apiClient } = this.app
    cookies.remove('sessionId')
    apiClient.invalidate('*', false)
    this.setInterval()
  }

  dispose() {
    if (this.intervalId) {
      clearInterval(this.intervalId)
    }

    this.intervalId = null
  }
}
