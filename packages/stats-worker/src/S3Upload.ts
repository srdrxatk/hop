import { Credentials } from '@aws-sdk/types'
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { awsAccessKeyId, awsRegion, awsSecretAccessKey } from './config.js'

let credentials: Credentials | undefined
if (awsAccessKeyId && awsSecretAccessKey) {
  credentials = {
    accessKeyId: awsAccessKeyId,
    secretAccessKey: awsSecretAccessKey
  }
}

const client = new S3Client({
  region: awsRegion,
  credentials
})

class S3Upload {
  async upload (key: string, data: any) {
    console.log('uploading')
    const input = {
      Bucket: 'assets.hop.exchange',
      Key: key,
      Body: JSON.stringify(data, null, 2),
      ACL: 'public-read'
    }
    const command = new PutObjectCommand(input)
    await client.send(command)
    console.log('uploaded to s3')
  }
}

export default S3Upload
