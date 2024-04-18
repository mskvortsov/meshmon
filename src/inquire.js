'use strict';

// The original protobufjs/inquire module contains unsafe eval which triggers
// a CSP violation. Remove that, since there is no need for any reflection
// in this project.
export default function inquire() {
    return null;
}
