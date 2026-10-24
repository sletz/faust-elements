# A delay of unbounded interval: faust-rs allocates 2^31 samples

**Status:** open, faust-rs `main-dev` 172305ea (2026-10-22, faustprobe 0.9.2).

`unbounded.dsp` reads a recursion back at an offset that follows an oscillator,
through `int()`. The interval analysis cannot bound the oscillator (a recursion), so
the delay has no known maximum.

- The C++ compiler (Faust 2.90.15, `48cb8aeb2`) refuses the program:

  ```
  ERROR : possible negative values of : int(+(1e+01f,*(8e+01f,+(0.5f,Delay(...)))))
          used in delay expression : ...
          interval(-2.14748e+09,2.14748e+09,0)
  ```

- faust-rs accepts it and sizes the line to the largest int:

  ```
  float fRec1[2147483648];
  ...
  fRec1[(faust_wrap_sub(fIOTA, ...) & 2147483647)]
  ```

  The DSP class is then 8 GiB: a C++ host that allocates it on the stack crashes at
  once (clang: `stack frame size (17180235376) exceeds limit`, then a segmentation
  fault). faustprobe renders the program, which hides the problem.

```bash
../../../faust-rs/target/release/faust-rs unbounded.dsp -o /tmp/unbounded.cpp
grep -n "2147483648" /tmp/unbounded.cpp
```

In `dsp/elements.lib` the reverb's LFO-modulated reads had this shape; they are now
clamped to the offsets the C++ reads (`o1i`, `o2i` in `reverb`), which bounds the
lines for both compilers. A refusal with the interval, as the C++ compiler gives, or
a warning naming the delay, would have pointed at them.
