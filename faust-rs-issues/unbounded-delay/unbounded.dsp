// A recursion read back at an offset whose interval the compiler cannot bound:
// the offset follows a cosine oscillator (a recursion started at 0.5), through int().
start = 1 - 1';
lfo = (\(y0, y1).(1.99 * select2(start, y0, 0.5) - y1, select2(start, y0, 0.5))) ~ (_, _) : !, +(0.5);
k = int(10.0 + 80.0 * lfo);
process = \(x).((\(wp).(x + 0.5 * (wp @ (k - 1)))) ~ _);
