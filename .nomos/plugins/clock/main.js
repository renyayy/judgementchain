function pad(n) {
  return String(n).padStart(2, "0");
}

function formatTime(d) {
  // 24h format by default (simpler for users)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export default function init(api) {
  api.registerStatusBarItem({
    id: "clock",
    render(container) {
      container.textContent = formatTime(new Date());

      const timer = setInterval(() => {
        container.textContent = formatTime(new Date());
      }, 1000);

      return () => clearInterval(timer);
    },
  });
}

