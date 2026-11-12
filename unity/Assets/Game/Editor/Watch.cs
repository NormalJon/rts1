using System;
using System.IO;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace Rts.Game.EditorTools
{
    /// <summary>
    /// Puts the match in front of whoever opens the project.
    ///
    /// When the editor starts with nothing open, the match scene is opened,
    /// so that pressing Play shows the game and not an empty world. Pressing
    /// Play starts a match for the player against the computer.
    ///
    /// "Play a Match" and "Watch a Match" (the RTS menu) go one further: they
    /// open the scene and press Play with the game filling the editor window,
    /// the first with the player leading blue and the second with two computer
    /// players and nobody at the controls. The same can be asked for when
    /// starting the editor:
    ///   Unity.exe -projectPath unity -executeMethod Rts.Game.EditorTools.Watch.Play
    ///   Unity.exe -projectPath unity -executeMethod Rts.Game.EditorTools.Watch.Run
    ///
    /// Neither is done at once. While the editor is starting, its windows and
    /// its own idea of which scene is open are not settled, and anything done
    /// then is undone a moment later. So what is wanted is written down where
    /// it survives the editor reloading its scripts, and done once the editor
    /// has been quiet for a few moments.
    /// </summary>
    [InitializeOnLoad]
    public static class Watch
    {
        const string PLAY_WANTED = "Rts.Watch.PlayWanted";
        const string OPENED_ONCE = "Rts.Watch.OpenedOnce";
        /// <summary>Editor updates in a row with nothing going on before the editor counts as settled.</summary>
        const int QUIET_UPDATES = 20;

        static int quiet;

        static Watch()
        {
            if (Application.isBatchMode) return;
            if (SessionState.GetBool(PLAY_WANTED, false) || !SessionState.GetBool(OPENED_ONCE, false)) EditorApplication.update += WhenSettled;
        }

        [MenuItem("RTS/Play a Match", priority = 0)]
        public static void Play()
        {
            Start(MatchMode.Play);
        }

        [MenuItem("RTS/Watch a Match", priority = 1)]
        public static void Run()
        {
            Start(MatchMode.Watch);
        }

        static void Start(MatchMode mode)
        {
            // The game reads this when the match starts, and forgets it.
            SessionState.SetString(MatchRunner.ASKED_FOR_KEY, mode.ToString());
            SessionState.SetBool(PLAY_WANTED, true);
            quiet = 0;
            EditorApplication.update -= WhenSettled;
            EditorApplication.update += WhenSettled;
        }

        static void WhenSettled()
        {
            if (EditorApplication.isCompiling || EditorApplication.isUpdating || EditorApplication.isPlayingOrWillChangePlaymode)
            {
                quiet = 0;
                return;
            }
            if (++quiet < QUIET_UPDATES) return;
            EditorApplication.update -= WhenSettled;

            bool play = SessionState.GetBool(PLAY_WANTED, false);
            bool first = !SessionState.GetBool(OPENED_ONCE, false);
            SessionState.SetBool(PLAY_WANTED, false);
            SessionState.SetBool(OPENED_ONCE, true);
            if (!File.Exists(ProjectSetup.SCENE))
            {
                Debug.LogWarning("[RTS] there is no match scene yet; choose RTS > Set Up Project");
                return;
            }

            Scene active = SceneManager.GetActiveScene();
            bool nothingOpen = string.IsNullOrEmpty(active.path) && !active.isDirty;
            if (play)
            {
                if (active.path != ProjectSetup.SCENE)
                {
                    if (!EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo()) return;
                    EditorSceneManager.OpenScene(ProjectSetup.SCENE);
                }
                FillTheWindow();
                Debug.Log("[RTS] starting the match");
                EditorApplication.isPlaying = true;
            }
            else if (first && nothingOpen)
            {
                EditorSceneManager.OpenScene(ProjectSetup.SCENE);
                Debug.Log("[RTS] opened the match scene; press Play to play a match");
            }
        }

        /// <summary>Has the Game view take the whole editor window while the match plays.</summary>
        static void FillTheWindow()
        {
            try
            {
                // The Game view is not a public class, so it is found by name.
                Type gameView = typeof(EditorWindow).Assembly.GetType("UnityEditor.GameView");
                if (gameView == null) return;
                EditorWindow window = EditorWindow.GetWindow(gameView);
                window.Show();
                window.Focus();
                window.maximized = true;
            }
            catch (Exception problem)
            {
                Debug.LogWarning("[RTS] could not make the Game view fill the window: " + problem.Message);
            }
        }
    }
}
