// All game data lives here. Edit this file to change cards, prices, rents or the board order.

// Lands: [name, color, price]. Lands sharing a color form a set.
const lands = [
  ['Midnight Vale', '#232a45', 60], ['Light House', '#232a45', 60], ['Frost Town', '#232a45', 80],
  ['Alabaster Dome', '#e865b3', 100], ['Alabaster Prime', '#e865b3', 120],
  ['Ola Orchard', '#e08a3c', 140], ['Ola Town', '#e08a3c', 140], ['Everland', '#e08a3c', 160],
  ['Varyon', '#4263d6', 180], ['Meadowbrook', '#4263d6', 180], ['Ravinta', '#4263d6', 200],
  ['Mossy Ruins', '#62b85a', 220], ['Wrenwen', '#62b85a', 220], ['Bramble Tavern', '#62b85a', 240],
  ['Denniver', '#f2c244', 260], ['Oasis', '#f2c244', 260], ['Sand Valley', '#f2c244', 280],
  ['Sloop Scoop', '#00a6a8', 300], ['Galleon Way', '#00a6a8', 300], ['Seabrom’s Site', '#00a6a8', 320],
  ['Coral Village', '#f46a6a', 350], ['Helichrys', '#f46a6a', 400],
  ['North Checkpoint', '#7a8588', 200], ['South Checkpoint', '#7a8588', 200], ['East Checkpoint', '#7a8588', 200], ['West Checkpoint', '#7a8588', 200],
  ['King’s Monument', '#8a6d3b', 150], ['Queen’s Monument', '#8a6d3b', 150]
];

// Rent: [no buildings, 1 Tavern, 2 Taverns, 3 Taverns, Keep]. A full color set doubles the bare rent.
const RENTS = {
  'Midnight Vale': [5, 20, 60, 150, 250], 'Light House': [5, 20, 60, 150, 250], 'Frost Town': [10, 40, 100, 250, 400],
  'Alabaster Dome': [10, 50, 130, 300, 450], 'Alabaster Prime': [10, 60, 150, 350, 500],
  'Ola Orchard': [15, 70, 180, 400, 600], 'Ola Town': [15, 70, 180, 400, 600], 'Everland': [15, 80, 200, 450, 650],
  'Varyon': [15, 90, 220, 500, 700], 'Meadowbrook': [15, 90, 220, 500, 700], 'Ravinta': [20, 100, 250, 550, 750],
  'Mossy Ruins': [20, 110, 280, 600, 800], 'Wrenwen': [20, 110, 280, 600, 800], 'Bramble Tavern': [20, 120, 300, 650, 850],
  'Denniver': [25, 130, 330, 700, 900], 'Oasis': [25, 130, 330, 700, 900], 'Sand Valley': [25, 140, 350, 750, 950],
  'Sloop Scoop': [25, 150, 380, 800, 1000], 'Galleon Way': [25, 150, 380, 800, 1000], 'Seabrom’s Site': [30, 160, 400, 850, 1050],
  'Coral Village': [35, 175, 450, 950, 1200], 'Helichrys': [50, 200, 550, 1100, 1500]
};
const TAVERN_COST = { '#232a45': 50, '#e865b3': 50, '#e08a3c': 100, '#4263d6': 100, '#62b85a': 150, '#f2c244': 150, '#00a6a8': 200, '#f46a6a': 200 };
const CHECKPOINT_RENT = [25, 50, 100, 200];

// The 40 spaces, clockwise from Avalon Gate (bottom right).
const TILE_NAMES = ['Avalon Gate', 'Midnight Vale', 'Treasure Chest', 'Light House', 'Frost Town', 'West Checkpoint', 'Alabaster Dome', 'Quest Line', 'Alabaster Prime', 'Ola Orchard',
  'the Dungeon', 'Ola Town', 'Fate', 'Everland', 'Varyon', 'North Checkpoint', 'Meadowbrook', 'Queen’s Monument', 'Ravinta', 'Treasure Chest',
  'Traveling Circus', 'Mossy Ruins', 'Fate', 'Wrenwen', 'Bramble Tavern', 'East Checkpoint', 'Denniver', 'King’s Monument', 'Oasis', 'Sand Valley',
  'To the Dungeon', 'Sloop Scoop', 'Quest Line', 'Galleon Way', 'Seabrom’s Site', 'South Checkpoint', 'Treasure Chest', 'Coral Village', 'Fate', 'Helichrys'];

const characters = ['Penny', 'Vedusa', 'Flynn', 'Nun', 'Devil'];
const ringColors = [['Coral', '#f46a6a'], ['Orange', '#e08a3c'], ['Gold', '#f2c244'], ['Green', '#62b85a'],
  ['Teal', '#00a6a8'], ['Blue', '#4263d6'], ['Purple', '#8e5bd6'], ['Pink', '#e865b3']];
const startPurse = { 500: 2, 100: 3, 50: 2, 10: 6, 5: 8 };

const decks = [
  { key: 'quest', name: 'Quest', color: '#6ca474', cards: [
    'Fetch a keepsake from Light House and bring it back.', 'Escort a traveler to the nearest checkpoint.',
    'Clear the Mossy Ruins of pests.', 'Win a dice duel against any player.', 'Deliver a message to Alabaster Dome.',
    'Find the lost crown near King’s Monument.', 'Cross the Oasis without losing a coin.', 'Visit three checkpoints in a row.',
    'Slay the beast beneath Frost Town.', 'Bring a treasure to the Traveling Circus.'] },
  { key: 'chest', name: 'Treasure Chest', color: '#3a4887', cards: [
    'A pouch of gold coins. Collect 100.', 'Ancient map. Peek at the next Fate card.', 'Healing potion. Keep it for later.',
    'Jeweled dagger. Trade it or keep it.', 'Mimic! Pay 50 to escape.', 'Lucky charm. Reroll any one die.',
    'Sack of gems. Collect 200.', 'Rusty key. Opens one Dungeon door.', 'Enchanted boots. Move 2 extra spaces.', 'Spoiled rations. Lose 50.'] },
  { key: 'fate', name: 'Fate', color: '#c04482', cards: [
    'A storm rolls in. Go back 3 spaces.', 'Pirates! Hand over 100.', 'A kind stranger gives you a ride. Move forward 4.',
    'The tide carries you to the nearest checkpoint.', 'You are summoned to the Dungeon.', 'Rumors spread. Swap places with any player.',
    'A festival begins. Everyone gives you 20.', 'Fog descends. Roll again and move back.', 'Your luck turns. Collect 150.',
    'A bridge collapses. Take the long way.'] }
];

module.exports = { lands, RENTS, TAVERN_COST, CHECKPOINT_RENT, TILE_NAMES, characters, ringColors, startPurse, decks };
