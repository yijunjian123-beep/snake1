export function logServerEvent(event, fields = {}) {
    const logLevel = process.env.LOG_LEVEL?.trim().toLowerCase();
    if (logLevel === "silent" || logLevel === "off") {
        return;
    }
    console.log(JSON.stringify({
        ts: new Date().toISOString(),
        event,
        ...fields,
    }));
}
