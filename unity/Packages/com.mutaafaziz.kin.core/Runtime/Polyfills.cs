// Unity compiles C# 9 against .NET Standard 2.1, which lacks the marker type that `init`
// accessors and records need. .NET 5+ has it, so it is only defined where it's missing.
#if !NET5_0_OR_GREATER
namespace System.Runtime.CompilerServices
{
    internal static class IsExternalInit { }
}
#endif
