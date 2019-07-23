export interface AccessTokenPayload {
  sub: string
  email: string
}

export interface RefreshTokenPayload {
  sub: string
  type: 'refresh'
  persist: boolean
}
