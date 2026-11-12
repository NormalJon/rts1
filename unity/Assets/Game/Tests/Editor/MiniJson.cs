using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace Rts.Game.Tests
{
    /// <summary>
    /// Reads JSON text into plain objects: a Dictionary for an object, a List
    /// for an array, a string, a long or double for a number, a bool, or null.
    /// Only for reading the recorded matches in the tests; Unity has no JSON
    /// reader of its own that copes with a list of differently shaped
    /// commands.
    /// </summary>
    public static class MiniJson
    {
        public static object Parse(string text)
        {
            int at = 0;
            object value = Value(text, ref at);
            Skip(text, ref at);
            if (at != text.Length) throw new FormatException("unexpected text after the end of the JSON at " + at);
            return value;
        }

        static void Skip(string text, ref int at)
        {
            while (at < text.Length && char.IsWhiteSpace(text[at])) at++;
        }

        static object Value(string text, ref int at)
        {
            Skip(text, ref at);
            if (at >= text.Length) throw new FormatException("the JSON ends early");
            char c = text[at];
            switch (c)
            {
                case '{':
                {
                    var result = new Dictionary<string, object>();
                    at++;
                    Skip(text, ref at);
                    if (text[at] == '}') { at++; return result; }
                    while (true)
                    {
                        Skip(text, ref at);
                        string key = String(text, ref at);
                        Skip(text, ref at);
                        if (text[at++] != ':') throw new FormatException("expected ':' at " + (at - 1));
                        result[key] = Value(text, ref at);
                        Skip(text, ref at);
                        char next = text[at++];
                        if (next == '}') return result;
                        if (next != ',') throw new FormatException("expected ',' or '}' at " + (at - 1));
                    }
                }
                case '[':
                {
                    var result = new List<object>();
                    at++;
                    Skip(text, ref at);
                    if (text[at] == ']') { at++; return result; }
                    while (true)
                    {
                        result.Add(Value(text, ref at));
                        Skip(text, ref at);
                        char next = text[at++];
                        if (next == ']') return result;
                        if (next != ',') throw new FormatException("expected ',' or ']' at " + (at - 1));
                    }
                }
                case '"':
                    return String(text, ref at);
                case 't':
                    Expect(text, ref at, "true");
                    return true;
                case 'f':
                    Expect(text, ref at, "false");
                    return false;
                case 'n':
                    Expect(text, ref at, "null");
                    return null;
                default:
                    return Number(text, ref at);
            }
        }

        static void Expect(string text, ref int at, string word)
        {
            if (string.CompareOrdinal(text, at, word, 0, word.Length) != 0) throw new FormatException("unexpected text at " + at);
            at += word.Length;
        }

        static object Number(string text, ref int at)
        {
            int start = at;
            bool whole = true;
            while (at < text.Length)
            {
                char c = text[at];
                if (c == '.' || c == 'e' || c == 'E') whole = false;
                else if (!(c == '-' || c == '+' || (c >= '0' && c <= '9'))) break;
                at++;
            }
            string digits = text.Substring(start, at - start);
            if (digits.Length == 0) throw new FormatException("unexpected text at " + start);
            if (whole && long.TryParse(digits, NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out long number)) return number;
            return double.Parse(digits, NumberStyles.Float, CultureInfo.InvariantCulture);
        }

        static string String(string text, ref int at)
        {
            if (text[at] != '"') throw new FormatException("expected a string at " + at);
            at++;
            int start = at;
            // Most strings have nothing escaped in them, and some are very long.
            while (text[at] != '"' && text[at] != '\\') at++;
            if (text[at] == '"') return text.Substring(start, at++ - start);
            var result = new StringBuilder(text, start, at - start, Math.Max(16, (at - start) * 2));
            while (true)
            {
                char c = text[at++];
                if (c == '"') return result.ToString();
                if (c != '\\')
                {
                    result.Append(c);
                    continue;
                }
                char escaped = text[at++];
                switch (escaped)
                {
                    case 'n': result.Append('\n'); break;
                    case 't': result.Append('\t'); break;
                    case 'r': result.Append('\r'); break;
                    case 'b': result.Append('\b'); break;
                    case 'f': result.Append('\f'); break;
                    case 'u':
                        result.Append((char)int.Parse(text.Substring(at, 4), NumberStyles.HexNumber, CultureInfo.InvariantCulture));
                        at += 4;
                        break;
                    default: result.Append(escaped); break;
                }
            }
        }
    }
}
