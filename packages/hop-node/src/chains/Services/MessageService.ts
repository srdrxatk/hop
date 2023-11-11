import { providers } from 'ethers'
import AbstractService from './AbstractService'

abstract class MessageService<T, U, V = null> extends AbstractService {
  protected abstract getMessage (txHash: string, opts: V | null): Promise<T>
  protected abstract getMessageStatus (message: T, opts: V | null): Promise<U>
  protected abstract sendRelayTransaction (message: T, opts: V | null): Promise<providers.TransactionResponse>
  protected abstract isMessageInFlight (messageStatus: U): Promise<boolean> | boolean
  protected abstract isMessageCheckpointed (messageStatus: U): Promise<boolean> | boolean
  protected abstract isMessageRelayed (messageStatus: U): Promise<boolean> | boolean

  // Call a private method so the validation is guaranteed to run in order
  protected async validateMessageAndSendTransaction (txHash: string, relayOpts: V | null = null): Promise<providers.TransactionResponse> {
    return this._validateMessageAndSendTransaction(txHash, relayOpts)
  }

  private async _validateMessageAndSendTransaction (txHash: string, relayOpts: V | null): Promise<providers.TransactionResponse> {
    const message: T = await this.getMessage(txHash, relayOpts)
    const messageStatus: U = await this.getMessageStatus(message, relayOpts)
    await this.validateMessageStatus(messageStatus)
    return this.sendRelayTransaction(message, relayOpts)
  }

  private async validateMessageStatus (messageStatus: U): Promise<void> {
    if (!messageStatus) {
      throw new Error('expected message status')
    }

    if (await this.isMessageInFlight(messageStatus)) {
      throw new Error('expected deposit to be claimable')
    }

    if (await this.isMessageRelayed(messageStatus)) {
      throw new Error('expected deposit to be claimable')
    }

    if (!(await this.isMessageCheckpointed(messageStatus))) {
      throw new Error('expected deposit to be relayable')
    }
  }
}

export default MessageService
