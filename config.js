module.exports = {
  company: {
    name: "Dr Phone",
    phone: "03 62 02 06 22",
    phoneHref: "033362020622",
    email: "drphonenord@gmail.com",
    address: "4T rue Guillaume du Fay, 59400 Cambrai",
  },
  // Opening hours by weekday: 0=Sun .. 6=Sat
  hours: {
    0: { start: "10:00", end: "20:00" }, // Sun
    1: { start: "08:00", end: "19:00" }, // Mon
    2: { start: "08:00", end: "19:00" },
    3: { start: "08:00", end: "19:00" },
    4: { start: "08:00", end: "19:00" },
    5: { start: "08:00", end: "19:00" },
    6: { start: "08:00", end: "20:00" }, // Sat
  },
  slotMinutes: 30,
  maxPerSlot: 3,
  adminPassword: "Theodawson?",
};
