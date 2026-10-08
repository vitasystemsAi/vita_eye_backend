// Timer for the live-monitoring loop. Worker timers are not subject to the heavy throttling
// browsers apply to timers in hidden tabs, so monitoring keeps its frame rate in the background.
self.onmessage = (e) => {
  setTimeout(() => self.postMessage(e.data.id), e.data.ms);
};
