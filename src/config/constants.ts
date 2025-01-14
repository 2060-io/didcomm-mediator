import { LogLevel } from '@credo-ts/core'
import dotenv from 'dotenv'

dotenv.config()

export const AGENT_PORT = Number(process.env.AGENT_PORT || 4000)
export const AGENT_LOG_LEVEL = process.env.AGENT_LOG_LEVEL ? Number(process.env.AGENT_LOG_LEVEL) : LogLevel.debug

export const AGENT_NAME = process.env.AGENT_NAME || 'Test Cloud Agent'
export const AGENT_ENDPOINTS = process.env.AGENT_ENDPOINTS?.replace(' ', '').split(',') || ['ws://localhost:4000']
export const AGENT_PUBLIC_DID = process.env.AGENT_PUBLIC_DID
export const HTTP_SUPPORT = Boolean(process.env.HTTP_SUPPORT ?? true)
export const WS_SUPPORT = Boolean(process.env.WS_SUPPORT ?? true)

// Wallet
export const WALLET_NAME = process.env.WALLET_NAME || 'test-cloud-agent'
export const WALLET_KEY = process.env.WALLET_KEY || 'Test Cloud Agent'
export const KEY_DERIVATION_METHOD = process.env.KEY_DERIVATION_METHOD
export const POSTGRES_HOST = process.env.POSTGRES_HOST
export const POSTGRES_USER = process.env.POSTGRES_USER
export const POSTGRES_PASSWORD = process.env.POSTGRES_PASSWORD
export const POSTGRES_ADMIN_USER = process.env.POSTGRES_ADMIN_USER
export const POSTGRES_ADMIN_PASSWORD = process.env.POSTGRES_ADMIN_PASSWORD
export const POSTGRES_DATABASE_NAME = process.env.POSTGRES_DATABASE_NAME

//FCM URL SERVICE

export const FCM_SERVICE_BASE_URL = process.env.FCM_SERVICE_BASE_URL

// Message Pickup Repository Client
export const MPR_WS_URL = process.env.MPR_WS_URL
export const MPR_MAX_RECEIVE_BYTES = Number(process.env.MPR_MAX_RECEIVE_BYTES)
