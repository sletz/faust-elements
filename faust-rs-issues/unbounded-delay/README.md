# A delay of unbounded interval: faust-rs allocated 2^31 samples

**Status:** fixed in faust-rs `main-dev` `10b26062` (2026-10-24):
`sigtype::check_delay_interval` refuses the program with the diagnostic
`delay-interval` (registry entry `DIFF-BEH-026`).

`unbounded.dsp` reads a recursion back at an offset that follows an oscillator,
through `int()`. The interval analysis cannot bound the oscillator (a recursion);
`int()` of an unbounded value is typed as the whole `i32` range, and the offset
`k - 1` as `[INT_MIN - 1, INT_MAX - 1]`.

- The C++ compiler (Faust 2.90.15, `48cb8aeb2`) refuses the program for the
  negative lower bound:

  ```
  ERROR : possible negative values of : int(+(1e+01f,*(8e+01f,+(0.5f,Delay(...)))))
          used in delay expression : ...
          interval(-2.14748e+09,2.14748e+09,0)
  ```

- faust-rs 172305ea accepted it: it tolerates a negative lower bound (variable
  delays clamp their index at run time), and the upper bound, `INT_MAX - 1`,
  passed. It sized the line to the largest int:

  ```
  float fRec1[2147483648];
  ```

  The DSP class was 8 GiB: a C++ host that allocates it on the stack crashed at
  once (clang: `stack frame size (17180235376) exceeds limit`, then a
  segmentation fault), while faustprobe rendered the program normally.

- The fix keeps the tolerance of a negative lower bound and refuses an upper
  bound of `INT_MAX` or more (as C++ does) and an interval spanning the whole
  integer range (`hi - lo >= 2^32 - 1`), with the diagnostic `delay-interval`
  ("delay amount spans the whole integer range ..."). The reduced case is an
  end-to-end test of faust-rs (`crates/compiler/tests/diagnostic_errors.rs`,
  `a_delay_bounded_only_by_the_int_range_is_rejected_like_cpp`).

```bash
../../../faust-rs/target/release/faust-rs unbounded.dsp -o /tmp/unbounded.cpp
```

In `dsp/elements.lib` the reverb's LFO-modulated reads had this shape; they are
clamped to the offsets the C++ reads (`o1i`, `o2i` in `reverb`), which bounds
the lines for both compilers and changes nothing in the output.

Full C++ parity (refusing any negative lower bound) was considered and set
aside: C++ checks delay amounts after normalization, where `x @ 100 @ (s - 100)`
folds to `x @ (s - 100 + 100)`, and faust-rs does not apply the delay normal
form at the top-level rate, so parity would refuse programs C++ compiles
(`rep_67`); porting that normal form changes generated code and is a separate
change.
