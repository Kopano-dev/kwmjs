# Kopano Web Meetings Client Library (kwmjs)

This projects implements a Javascript Client Library to interact with a Kopano
Webmeetings server.

## Install

```
yarn add https://stash.kopano.io/scm/kwm/kwmjs.git
```

## API and docs

KWMJS exposes a public API. The documentation can be generated with TypeScript
as follows:

```
make docs
```

Then to view the docs, open `dist/docs/index.html` in a browser of your choice.

## Usage

### Create a new call

```javascript
const kwm = new kwmjs.KWM();
kwm.connect('userA').then(() => {
        // Connected, ready to call.
        return kwm.webrtc.doCall('userB');
}).then(channel => {
        // Ringing, waiting for userB to accept call.
});
```

### Accept an incoming call

```javascript
const kwm = new kwmjs.KWM();
kwm.webrtc.onpeer = event => {
        switch (event.event) {
                case 'incomingcall':
                        kwm.webrtc.doAnswer(event.record.user).then(channel => {
                                // Waiting for connection to establish.
                        });
                        break;
        }
};
kwm.connect('userB').then(() => {
        // Connected, ready to accept calls.
});
```

### Debugging

Type in the following in the browser console to enable WebRTC debugging.

```
localStorage.debug = 'simple-peer'
```


## License

See `LICENSE.txt` for licensing information of this project.
