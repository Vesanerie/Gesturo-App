// Global state and DOM references shared across all modules.
// This file must load first.

const canvas = document.getElementById('canvas')
const wrap = document.getElementById('canvas-wrap')
const gridBg = document.getElementById('grid-bg')
const selRect = document.getElementById('selection-rect')

let zoom = 1, panX = 0, panY = 0
let isPanning = false, panStart = null
let photos = [], idCounter = 0
let selected = null, multiSelected = []
let dragState = null, resizeState = null, rotateState = null
let selectionState = null
let gridVisible = false
let panTool = false, spaceHeld = false
let currentProject = null
let saveTimer = null
let history = [], historyIndex = -1, historyMuted = false
let clipboardItems = []
let renameTargetFile = null
let allProjectsCache = []
let minimapVisible = false
let cropState = null
let alwaysOnTop = false
let grayscaleMode = false
let toastTimer = null
let groups = []
let guides = []
let guideIdCounter = 0
let lightMode = false
let searchOpen = false

const PROJECT_COLORS = ['#888888', '#ff6b6b', '#ffb03b', '#ffd93d', '#6bd968', '#4ec9d4', '#6b8cff', '#b46bff', '#ff6bd9']
let modalSelectedColor = PROJECT_COLORS[0]

const SNAP_THRESHOLD = 6
