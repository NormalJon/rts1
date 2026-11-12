using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.InputSystem.Controls;

namespace Rts.Game
{
    /// <summary>
    /// Reads the mouse and the keyboard and tells the controls what the player
    /// did. It decides nothing itself: which button, where, with shift or
    /// without, and which key. The keys are the browser version's.
    ///
    /// Moving the view with the arrows, the wheel and the middle button is the
    /// camera's own business (RtsCamera).
    /// </summary>
    public sealed class PlayerInput
    {
        readonly PlayerControls controls;
        readonly RtsCamera view;
        /// <summary>Says whether a point on the screen is over a panel and not the field.</summary>
        readonly Func<Vector2, bool> overPanel;
        /// <summary>Whether the left button went down on the field and has not come up yet.</summary>
        bool pressedOnField;
        readonly Dictionary<string, KeyControl> letters = new Dictionary<string, KeyControl>();
        Keyboard lettersFor;
        string lettersLayout;

        /// <summary>The devices to read. Left empty, whichever mouse and keyboard were last used.</summary>
        public Mouse mouse;
        public Keyboard keyboard;

        public PlayerInput(PlayerControls controls, RtsCamera view, Func<Vector2, bool> overPanel)
        {
            this.controls = controls;
            this.view = view;
            this.overPanel = overPanel;
        }

        /// <summary>Call once a frame, before the match is moved on.</summary>
        public void Read()
        {
            Keyboard keys = keyboard != null && keyboard.added ? keyboard : Keyboard.current;
            Mouse pointer = mouse != null && mouse.added ? mouse : Mouse.current;
            bool shift = keys != null && (keys.leftShiftKey.isPressed || keys.rightShiftKey.isPressed);

            if (pointer != null)
            {
                Vector2 at = pointer.position.ReadValue();
                bool onField = !overPanel(at);
                view.pointerOnField = onField;
                // A box being dragged out follows the pointer wherever it goes.
                if (onField || pressedOnField) controls.PointerMove(at);
                else controls.PointerAway();

                if (pointer.leftButton.wasPressedThisFrame && onField)
                {
                    pressedOnField = true;
                    controls.PointerDown(0, at, shift);
                }
                if (pointer.leftButton.wasReleasedThisFrame)
                {
                    if (pressedOnField) controls.PointerUp(0, at, shift);
                    pressedOnField = false;
                }
                if (pointer.rightButton.wasPressedThisFrame && onField) controls.PointerDown(1, at, shift);
            }
            if (keys != null) ReadKeys(keys, shift);
        }

        void ReadKeys(Keyboard keys, bool shift)
        {
            bool ctrl = keys.leftCtrlKey.isPressed || keys.rightCtrlKey.isPressed;
            bool alt = keys.leftAltKey.isPressed || keys.rightAltKey.isPressed;
            bool meta = keys.leftMetaKey.isPressed || keys.rightMetaKey.isPressed;

            // The digits: a group is saved with shift or ctrl, and recalled without.
            if (!alt)
            {
                for (int digit = 0; digit <= 9; digit++)
                {
                    if (keys[Key.Digit1 + (digit + 9) % 10].wasPressedThisFrame || keys[Key.Numpad0 + digit].wasPressedThisFrame)
                    {
                        controls.GroupKey(digit, ctrl || meta || shift);
                    }
                }
            }
            if (ctrl || meta || alt) return;

            for (int i = 0; i < PlayerControls.ACTION_KEYS.Length; i++)
            {
                if (Letter(keys, PlayerControls.ACTION_KEYS[i]).wasPressedThisFrame) controls.ActionKey(i);
            }
            if (Letter(keys, "s").wasPressedThisFrame) controls.Stop();
            if (Letter(keys, "a").wasPressedThisFrame) controls.Aim(Aiming.AttackMove);
            if (Letter(keys, "p").wasPressedThisFrame) controls.Aim(Aiming.Patrol);
            if (Letter(keys, "h").wasPressedThisFrame) controls.Hold();
            if (Letter(keys, "f").wasPressedThisFrame) controls.LookAtAlarm();
            if (keys.escapeKey.wasPressedThisFrame) controls.Escape();
            if (keys.deleteKey.wasPressedThisFrame || keys.backspaceKey.wasPressedThisFrame) controls.Demolish();
            if (keys.periodKey.wasPressedThisFrame) controls.SelectIdleVillager();
            if (keys.spaceKey.wasPressedThisFrame) controls.JumpToSelection();
            if (keys.equalsKey.wasPressedThisFrame || keys.numpadPlusKey.wasPressedThisFrame) view.Zoom(0.85f);
            if (keys.minusKey.wasPressedThisFrame || keys.numpadMinusKey.wasPressedThisFrame) view.Zoom(1f / 0.85f);
        }

        /// <summary>
        /// The key that types a letter on the keyboard as it is laid out, so that
        /// Q is the key marked Q whatever the layout. Failing that, the key in
        /// the place where an English keyboard has it.
        /// </summary>
        KeyControl Letter(Keyboard keys, string letter)
        {
            string layout = keys.keyboardLayout;
            if (lettersFor != keys || lettersLayout != layout)
            {
                letters.Clear();
                lettersFor = keys;
                lettersLayout = layout;
            }
            if (letters.TryGetValue(letter, out KeyControl found)) return found;
            found = keys.FindKeyOnCurrentKeyboardLayout(letter) ?? keys[(Key)Enum.Parse(typeof(Key), letter.ToUpperInvariant())];
            letters[letter] = found;
            return found;
        }
    }
}
