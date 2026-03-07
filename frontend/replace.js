import fs from 'fs';

const filePath = 'src/App.tsx';
let content = fs.readFileSync(filePath, 'utf8');

const replacements = {
    "Neural Workspace": "Workspace",
    "Neural Cache": "Saved Recordings",
    "Scan Neural": "Search",
    "Personal Cache": "My Recordings",
    "Cloud Cache": "Cloud Recordings",
    "Enterprise Feed": "Team Feed",
    "Neural Cloud": "Cloud Backup",
    "Capture Insight": "New Recording",
    "Quantum Cloud Sync": "Backup to Cloud",
    "Quantum Sync": "Cloud Sync",
    "Local Cache Active": "Local storage active",
    "Session Recovery": "Unsaved Recording Found",
    "Neural Capture (Auto-Save Active)": "Recording started — saving automatically",
    "Auto-listen armed": "Auto-record armed",
    "Auto-Listen": "Auto-Record",
    "Auto-listen": "Auto-record",
    "STUDIO LIVE": "LIVE STUDIO",
    "Studio Live": "Live Studio",
    "machine-panel": "app-panel",
    "machine-cta": "app-cta",
    "machine-nav-item": "app-nav-item"
};

for (const [key, value] of Object.entries(replacements)) {
    content = content.split(key).join(value);
}

fs.writeFileSync(filePath, content);
console.log('App.tsx Replacements completed.');
