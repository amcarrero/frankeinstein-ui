import workerpool from 'workerpool'

type WorkerTransfer = InstanceType<typeof workerpool.Transfer>

export interface TransferResult<T extends object> extends WorkerTransfer {
  readonly message: T
}

export function Transfer<T extends object>(
  message: T,
  transfer: Transferable[]
): TransferResult<T> {
  return new workerpool.Transfer(message, transfer) as TransferResult<T>
}
