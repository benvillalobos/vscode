# Snake Game Implementation

## Overview
A playable snake game embedded within the VS Code editor. The snake moves through the text, eating characters and growing longer.

## Files Created

### 1. `snakeGameController.ts`
Main game controller implementing `IEditorContribution`:
- **Game State**: Manages snake position, direction, score, speed
- **Game Loop**: Uses `disposableWindowInterval` for consistent timing (150ms initial, speeds up to 50ms)
- **Movement**: Arrow keys and WASD support with 180° turn prevention
- **Collision Detection**: Checks boundaries, self-collision
- **Character Eating**: Removes characters from editor text, increases score and speed
- **Decorations**: Visual rendering using `SNAKE_HEAD_DECORATION` and `SNAKE_BODY_DECORATION`
- **Game Over**: Blink animation and overlay displaying final score

### 2. `snakeGame.contribution.ts`
Registration and command definitions:
- Registers `SnakeGameController` as lazy editor contribution
- **Commands**:
  - `editor.action.startSnakeGame`: Start Snake Game (F1)
  - `editor.action.exitSnakeGame`: Exit Snake Game (F1)

### 3. `media/snakeGame.css`
Visual styling:
- `.snake-head`: Green background (#4CAF50) with pulse animation
- `.snake-body`: Light green background (#8BC34A)
- `.snake-blink`: Opacity fade animation for game over
- `.snake-game-over-overlay`: Centered score display

### 4. `workbench.common.main.ts`
Added import for snake game contribution

## Key Features

### Game Mechanics
- **Starting Position**: Middle of editor, moving up
- **Direction Changes**: Arrow keys or WASD, prevents 180° turns
- **Character Eating**: Consumes non-whitespace characters, replaces with space
- **Speed Progression**: Decreases interval by 5ms per character (150ms → 50ms min)
- **Collision Handling**:
  - Out of bounds (lines or columns)
  - Self-collision
  - Shows game over screen

### Technical Implementation
- **Multi-window Support**: Uses `dom.getWindow()` and `disposableWindowInterval`
- **Editor State Management**:
  - Locks editor with `readOnly: true` during gameplay
  - Restores original readonly state on exit
- **Decoration System**: Uses `ModelDecorationOptions` with `TrackedRangeStickiness`
- **Text Manipulation**: `pushEditOperations` to delete characters
- **Keyboard Input**: `onKeyDown` with keyCode mapping

### Commands
Both commands are accessible via Command Palette (F1):
1. **Start Snake Game**: Initializes game in active editor
2. **Exit Snake Game**: Stops game and restores editor state

## Remaining Work
- Context key for conditional command visibility (contextKeyService currently unused)
- Victory condition when all non-whitespace characters are consumed
- Keybinding defaults (optional)
- Tests

## Usage
1. Open a file with text content
2. Run "Start Snake Game" from Command Palette (F1)
3. Use arrow keys or WASD to control snake
4. Eat characters to grow and increase speed
5. Game ends on collision or exit

## Architecture Notes
- Follows VS Code contribution patterns (lazy loading, dependency injection)
- Proper disposal of resources (intervals, decorations, DOM elements)
- Multi-window safe timer usage
- Type-safe throughout (no `any` types)
