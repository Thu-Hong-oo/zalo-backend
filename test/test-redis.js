import { createClient } from 'redis';

const client = createClient({
    username: 'default',
    password: 'skdeht59pJM5OFJI2WY6C8e6SPNTHAa3',
    socket: {
        host: 'redis-14936.c252.ap-southeast-1-1.ec2.redns.redis-cloud.com',
        port: 14936
    }
});

client.on('error', err => console.log('Redis Client Error', err));

await client.connect();

await client.set('foo', 'bar');
const result = await client.get('foo');
console.log(result)  // >>> bar

