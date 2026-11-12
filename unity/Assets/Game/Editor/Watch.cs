using System;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace Rts.Game.EditorTools
{
    /// <summary>
    /// Opens the match scene and presses Play, with the game filling the
    /// editor window. From the menu (RTS > Watch a Match), or when starting
    /// the editor:
    ///   Unity.exe -projectPath unity -executeMethod Rts.Game.EditorTools.Watch.Run
    /// </summary>
    public static class Watch
    {
        [MenuItem("RTS/Watch a Match")]
        public static void Run()
        {
            // Not this instant: when the editor is only just starting, its windows are not there yet.
            EditorApplication.delayCall += Begin;
        }

        static void Begin()
        {
            if (EditorApplication.isPlayingOrWillChangePlaymode) return;
            if (!EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo()) return;
            EditorSceneManager.OpenScene(ProjectSetup.SCENE);
            try
            {
                // The Game view is not a public class, so it is found by name.
                Type gameView = typeof(EditorWindow).Assembly.GetType("UnityEditor.GameView");
                if (gameView != null)
                {
                    EditorWindow window = EditorWindow.GetWindow(gameView);
                    window.Show();
                    window.Focus();
                    window.maximized = true;
                }
            }
            catch (Exception problem)
            {
                Debug.LogWarning("[RTS] could not make the Game view fill the window: " + problem.Message);
            }
            EditorApplication.isPlaying = true;
        }
    }
}
