use std::mem::swap;
use base64::prelude::*;

// Sbox is pre-computed multiplicative inverse in GF(2^8) used in SubBytes and KeyExpansion [§5.1.1]
const S_BOX:[u8; 256] =
            [0x63,0x7c,0x77,0x7b,0xf2,0x6b,0x6f,0xc5,0x30,0x01,0x67,0x2b,0xfe,0xd7,0xab,0x76,
            0xca,0x82,0xc9,0x7d,0xfa,0x59,0x47,0xf0,0xad,0xd4,0xa2,0xaf,0x9c,0xa4,0x72,0xc0,
            0xb7,0xfd,0x93,0x26,0x36,0x3f,0xf7,0xcc,0x34,0xa5,0xe5,0xf1,0x71,0xd8,0x31,0x15,
            0x04,0xc7,0x23,0xc3,0x18,0x96,0x05,0x9a,0x07,0x12,0x80,0xe2,0xeb,0x27,0xb2,0x75,
            0x09,0x83,0x2c,0x1a,0x1b,0x6e,0x5a,0xa0,0x52,0x3b,0xd6,0xb3,0x29,0xe3,0x2f,0x84,
            0x53,0xd1,0x00,0xed,0x20,0xfc,0xb1,0x5b,0x6a,0xcb,0xbe,0x39,0x4a,0x4c,0x58,0xcf,
            0xd0,0xef,0xaa,0xfb,0x43,0x4d,0x33,0x85,0x45,0xf9,0x02,0x7f,0x50,0x3c,0x9f,0xa8,
            0x51,0xa3,0x40,0x8f,0x92,0x9d,0x38,0xf5,0xbc,0xb6,0xda,0x21,0x10,0xff,0xf3,0xd2,
            0xcd,0x0c,0x13,0xec,0x5f,0x97,0x44,0x17,0xc4,0xa7,0x7e,0x3d,0x64,0x5d,0x19,0x73,
            0x60,0x81,0x4f,0xdc,0x22,0x2a,0x90,0x88,0x46,0xee,0xb8,0x14,0xde,0x5e,0x0b,0xdb,
            0xe0,0x32,0x3a,0x0a,0x49,0x06,0x24,0x5c,0xc2,0xd3,0xac,0x62,0x91,0x95,0xe4,0x79,
            0xe7,0xc8,0x37,0x6d,0x8d,0xd5,0x4e,0xa9,0x6c,0x56,0xf4,0xea,0x65,0x7a,0xae,0x08,
            0xba,0x78,0x25,0x2e,0x1c,0xa6,0xb4,0xc6,0xe8,0xdd,0x74,0x1f,0x4b,0xbd,0x8b,0x8a,
            0x70,0x3e,0xb5,0x66,0x48,0x03,0xf6,0x0e,0x61,0x35,0x57,0xb9,0x86,0xc1,0x1d,0x9e,
            0xe1,0xf8,0x98,0x11,0x69,0xd9,0x8e,0x94,0x9b,0x1e,0x87,0xe9,0xce,0x55,0x28,0xdf,
            0x8c,0xa1,0x89,0x0d,0xbf,0xe6,0x42,0x68,0x41,0x99,0x2d,0x0f,0xb0,0x54,0xbb,0x16];

// Rcon is Round Constant used for the Key Expansion [1st col is 2^(r-1) in GF(2^8)] [§5.2]
const R_CON:[[u8; 4]; 11] = [
            [0x00, 0x00, 0x00, 0x00],
            [0x01, 0x00, 0x00, 0x00],
            [0x02, 0x00, 0x00, 0x00],
            [0x04, 0x00, 0x00, 0x00],
            [0x08, 0x00, 0x00, 0x00],
            [0x10, 0x00, 0x00, 0x00],
            [0x20, 0x00, 0x00, 0x00],
            [0x40, 0x00, 0x00, 0x00],
            [0x80, 0x00, 0x00, 0x00],
            [0x1b, 0x00, 0x00, 0x00],
            [0x36, 0x00, 0x00, 0x00]
];


// leave row 0, shift row 1 once, row two twice and row 3 three times
fn aes_shift_rows(s: &mut [[u8; 4]; 4]) {
    aes_rot_word(&mut s[1]);

    aes_rot_word(&mut s[2]);
    aes_rot_word(&mut s[2]);

    aes_rot_word(&mut s[3]);
    aes_rot_word(&mut s[3]);
    aes_rot_word(&mut s[3]);
}

/// apply SBox to 4-byte word w
/// (substitute every byte with its corresponent in the SBox)
fn aes_sub_word(w: &mut[u8; 4]) {
    // TODO use a for loop
    w[0] = S_BOX[w[0] as usize];
    w[1] = S_BOX[w[1] as usize];
    w[2] = S_BOX[w[2] as usize];
    w[3] = S_BOX[w[3] as usize];
}

/// apply SBox to state S [§5.1.1]
fn aes_sub_bytes(s: &mut [[u8; 4]; 4]) {
    aes_sub_word(&mut s[0]);
    aes_sub_word(&mut s[1]);
    aes_sub_word(&mut s[2]);
    aes_sub_word(&mut s[3]);
}

/// rotate 4-byte word w left by one byte
fn aes_rot_word(w: &mut[u8; 4]) {
    let tmp = w[0];
    w[0] = w[1];
    w[1] = w[2];
    w[2] = w[3];
    w[3] = tmp;
}

#[cfg(test)]
mod tests {

    #[test]
    fn aes_rot_word() {
      let mut word = [1, 2, 3, 4];
      super::aes_rot_word(&mut word);
      assert_eq!(word, [2, 3, 4, 1]);
    }

    #[test]
    fn aes_sub_word() {
      let mut word = [1, 2, 3, 4];
      super::aes_sub_word(&mut word);
      assert_eq!(word, [0x7c,0x77,0x7b,0xf2]);
    }
}

fn mix_column(r: &mut [u8; 4]) {
    let mut a: [u8; 4] = [0; 4];
    let mut b: [u8; 4] = [0; 4];
    /* The array 'a' is simply a copy of the input array 'r'
     * The array 'b' is each element of the array 'a' multiplied by 2
     * in Rijndael's Galois field
     * a[n] ^ b[n] is element n multiplied by 3 in Rijndael's Galois field */ 
    for c in 0..4 {
        a[c] = r[c];
        /* h is 0xff if the high bit of r[c] is set, 0 otherwise */
        let h: u8 = ((r[c] as i8) >> 7) as u8; /* arithmetic right shift, thus shifting in either zeros or ones */
        b[c] = r[c] << 1; /* implicitly removes high bit because b[c] is an 8-bit char, so we xor by 0x1b and not 0x11b in the next line */
        b[c] ^= 0x1B & h; /* Rijndael's Galois field */
    }
    r[0] = b[0] ^ a[3] ^ a[2] ^ b[1] ^ a[1]; /* 2 * a0 + a3 + a2 + 3 * a1 */
    r[1] = b[1] ^ a[0] ^ a[3] ^ b[2] ^ a[2]; /* 2 * a1 + a0 + a3 + 3 * a2 */
    r[2] = b[2] ^ a[1] ^ a[0] ^ b[3] ^ a[3]; /* 2 * a2 + a1 + a0 + 3 * a3 */
    r[3] = b[3] ^ a[2] ^ a[1] ^ b[0] ^ a[0]; /* 2 * a3 + a2 + a1 + 3 * a0 */
 
}


fn transpose(s: &mut[[u8; 4]; 4]) {
    let mut temp: [[u8; 4]; 4] = [
        [s[0][0], s[1][0], s[2][0], s[3][0]],
        [s[0][1], s[1][1], s[2][1], s[3][1]],
        [s[0][2], s[1][2], s[2][2], s[3][2]],
        [s[0][3], s[1][3], s[2][3], s[3][3]]
    ];
    swap(s, &mut temp);
}

fn aes_mix_columns(s: &mut [[u8; 4]; 4]) {
    transpose(s);
    mix_column(&mut s[0]);
    mix_column(&mut s[1]);
    mix_column(&mut s[2]);
    mix_column(&mut s[3]);
    transpose(s);
}

#[cfg(test)]
mod tests_mix_columns {
    #[test]
    fn mix_column() {
        let mut t = [0xdb, 0x13, 0x53, 0x45];
        super::mix_column(&mut t);
        assert_eq!(t, [0x8e, 0x4d, 0xa1, 0xbc]);

        let mut t = [0xf2, 0x0a, 0x22, 0x5c];	
        super::mix_column(&mut t);
        assert_eq!(t, [0x9f, 0xdc, 0x58, 0x9d]);

        let mut t = [0x01, 0x01, 0x01, 0x01];	
        super::mix_column(&mut t);
        assert_eq!(t, [0x01, 0x01, 0x01, 0x01]);

        let mut t = [0xc6, 0xc6, 0xc6, 0xc6];
        super::mix_column(&mut t);
        assert_eq!(t, [0xc6, 0xc6, 0xc6, 0xc6]);

        let mut t = [0xd4, 0xd4, 0xd4, 0xd5];
        super::mix_column(&mut t);
        assert_eq!(t, [0xd5, 0xd5, 0xd7, 0xd6]);

        let mut t = [0x2d, 0x26, 0x31, 0x4c];
        super::mix_column(&mut t);
	    assert_eq!(t, [0x4d, 0x7e, 0xbd, 0xf8]);
    }

    #[test]
    fn mix_columns() {
        let mut s = [
            [0xdb, 0xf2, 0x01, 0x2d],
            [0x13, 0x0a, 0x01, 0x26],
            [0x53, 0x22, 0x01, 0x31],
            [0x45, 0x5c, 0x01, 0x4c]
        ];
        super::aes_mix_columns(&mut s);
        assert_eq!(s[0], [0x8e, 0x9f, 0x01, 0x4d]);
    }

}

fn xor(state: &mut [u8; 4], sub_key: &[u8; 4]) {
    for it in state.iter_mut().zip(sub_key.iter()) {
        let (s, k) = it;
        *s ^= k; 
    }
}

fn aes_add_round_key(state: &mut [[u8; 4]; 4], w: &[[u8; 4]; 60], round: usize) {  // xor Round Key into state S [§5.1.4]
    // combine like for matrix multiplication
    xor(&mut state[0], & [w[round * 4][0], w[round * 4 + 1][0], w[round * 4 + 2][0], w[round * 4 + 3][0],]);
    xor(&mut state[1], & [w[round * 4][1], w[round * 4 + 1][1], w[round * 4 + 2][1], w[round * 4 + 3][1],]);
    xor(&mut state[2], & [w[round * 4][2], w[round * 4 + 1][2], w[round * 4 + 2][2], w[round * 4 + 3][2],]);
    xor(&mut state[3], & [w[round * 4][3], w[round * 4 + 1][3], w[round * 4 + 2][3], w[round * 4 + 3][3],]);
}

#[cfg(test)]
mod tests_aes_add_round_key {
    #[test]
    fn aes_add_round_key() {
        let mut state = [
            [0, 0, 0, 0],
            [0, 0, 0, 0],
            [0, 0, 0, 0],
            [0, 0, 0, 0],
        ];
        let mut w:[[u8; 4]; 60] = [[0; 4]; 60];
        w[5][0] = 1;
        super::aes_add_round_key(&mut state, &w, 1);
        assert_eq!(state[0][1], 1);
    }
}


fn aes_key_expansion(key: &[u8; 32]) -> [[u8; 4]; 60] {  // generate Key Schedule (byte-array Nr+1 x Nb) from Key [§5.2]
    //4 int Nb = 4;            // block size (in words): no of columns in state (fixed at 4 for AES)
    let key_length_words = key.len() / 4;  // key length (in words): 4/6/8 for 128/192/256-bit keys
    let _rounds = key_length_words + 6;       // no of rounds: 10/12/14 for 128/192/256-bit keys

    let mut w: [[u8; 4]; 60] = [[8; 4]; 60];

    for i in 0..key_length_words {
        w[i] = [key[4 * i], key[4 * i + 1], key[4 * i + 2], key[4 * i + 3]];
    }

    for i in key_length_words..60 {
        let mut temp = [w[i - 1][0], w[i - 1][1], w[i - 1][2], w[i - 1][3]];
        if i % key_length_words == 0 {
            aes_rot_word(&mut temp);
            aes_sub_word(&mut temp);
            temp[0] ^= R_CON[i / key_length_words][0];
            temp[1] ^= R_CON[i / key_length_words][1];
            temp[2] ^= R_CON[i / key_length_words][2];
            temp[3] ^= R_CON[i / key_length_words][3];
        } else if i%key_length_words == 4 {
            aes_sub_word(&mut temp);
        }
        w[i][0] = w[i - key_length_words][0] ^ temp[0];
        w[i][1] = w[i - key_length_words][1] ^ temp[1];
        w[i][2] = w[i - key_length_words][2] ^ temp[2];
        w[i][3] = w[i - key_length_words][3] ^ temp[3];
    }
    w
}

#[cfg(test)]
mod tests_key_expansion {
    #[test]
    fn expand_key() {
        let expected = [
            [0x73, 0x65, 0x63, 0x72],
            [0x65, 0x74, 0x20, 0x73],
            [0x65, 0x63, 0x72, 0x65],
            [0x74, 0x20, 0x73, 0x65],
            [0x63, 0x72, 0x65, 0x74],
            [0x20, 0x73, 0x65, 0x63],
            [0x72, 0x65, 0x74, 0x00],
            [0x00, 0x00, 0x00, 0x00],
            [0x11, 0x06, 0x00, 0x11],
            [0x74, 0x72, 0x20, 0x62],
            [0x11, 0x11, 0x52, 0x07],
            [0x65, 0x31, 0x21, 0x62],
            [0x2e, 0xb5, 0x98, 0xde],
            [0x0e, 0xc6, 0xfd, 0xbd],
            [0x7c, 0xa3, 0x89, 0xbd],
            [0x7c, 0xa3, 0x89, 0xbd],
            [0x19, 0xa1, 0x7a, 0x01],
            [0x6d, 0xd3, 0x5a, 0x63],
            [0x7c, 0xc2, 0x08, 0x64],
            [0x19, 0xf3, 0x29, 0x06],
            [0xfa, 0xb8, 0x3d, 0xb1],
            [0xf4, 0x7e, 0xc0, 0x0c],
            [0x88, 0xdd, 0x49, 0xb1],
            [0xf4, 0x7e, 0xc0, 0x0c],
            [0xee, 0x1b, 0x84, 0xbe],
            [0x83, 0xc8, 0xde, 0xdd],
            [0xff, 0x0a, 0xd6, 0xb9],
            [0xe6, 0xf9, 0xff, 0xbf],
            [0x74, 0x21, 0x2b, 0xb9],
            [0x80, 0x5f, 0xeb, 0xb5],
            [0x08, 0x82, 0xa2, 0x04],
            [0xfc, 0xfc, 0x62, 0x08],
            [0x56, 0xb1, 0xb4, 0x0e],
            [0xd5, 0x79, 0x6a, 0xd3],
            [0x2a, 0x73, 0xbc, 0x6a],
            [0xcc, 0x8a, 0x43, 0xd5],
            [0x3f, 0x5f, 0x31, 0xba],
            [0xbf, 0x00, 0xda, 0x0f],
            [0xb7, 0x82, 0x78, 0x0b],
            [0x4b, 0x7e, 0x1a, 0x03],
            [0xb5, 0x13, 0xcf, 0xbd],
            [0x60, 0x6a, 0xa5, 0x6e],
            [0x4a, 0x19, 0x19, 0x04],
            [0x86, 0x93, 0x5a, 0xd1],
            [0x7b, 0x83, 0x8f, 0x84],
            [0xc4, 0x83, 0x55, 0x8b],
            [0x73, 0x01, 0x2d, 0x80],
            [0x38, 0x7f, 0x37, 0x83],
            [0x47, 0x89, 0x23, 0xba],
            [0x27, 0xe3, 0x86, 0xd4],
            [0x6d, 0xfa, 0x9f, 0xd0],
            [0xeb, 0x69, 0xc5, 0x01],
            [0x92, 0x7a, 0x29, 0xf8],
            [0x56, 0xf9, 0x7c, 0x73],
            [0x25, 0xf8, 0x51, 0xf3],
            [0x1d, 0x87, 0x66, 0x70],
            [0x10, 0xba, 0x72, 0x1e],
            [0x37, 0x59, 0xf4, 0xca],
            [0x5a, 0xa3, 0x6b, 0x1a],
            [0xb1, 0xca, 0xae, 0x1b],
        ];

        let mut key:[u8; 32] = [0; 32];
        for (i, c) in "secret secret secret secret".char_indices() {
            key[i] = c as u8;
        }
        let expanded_key = super::aes_key_expansion(&key);
        for i in 0..60 {
            assert_eq!(expanded_key[i], expected[i], "row {}", i);
        }

        assert_eq!(std::mem::size_of_val(&expected), 240, "Expect the array to be 60 x 4 bytes in size");
    }

}

// no of rounds: 10/12/14 for 128/192/256-bit keys
const ROUNDS: usize = 14;

/**
 * AES Cipher function: encrypt 'input' state with Rijndael algorithm
 *   applies Nr rounds (10/12/14) using key schedule w for 'add round key' stage
 *
 * @param input 16-byte (128-bit) input state array
 * @param w   Key schedule as 2D byte-array (Nr+1 x Nb bytes) 11 x 4
 * @return Encrypted output state array
 */
fn aes_cipher(input: &[u8], w: &[[u8; 4]; 60]) -> [u8; 16] {    // main Cipher function [§5.1]
    // initialise 4xNb byte-array 'state' with input [§3.4]
    let mut state: [[u8; 4]; 4] = [
        [input[0], input[4], input[8], input[12]],
        [input[1], input[5], input[9], input[13]],
        [input[2], input[6], input[10], input[14]],
        [input[3], input[7], input[11], input[15]],
    ];
    //print_w(w);
    aes_add_round_key(&mut state, w, 0);

    for round in 1..ROUNDS {
        aes_sub_bytes(&mut state);
        aes_shift_rows(&mut state);
        aes_mix_columns(&mut state);
        aes_add_round_key(&mut state, w, round);
    }

    aes_sub_bytes(&mut state);
    aes_shift_rows(&mut state);
    aes_add_round_key(&mut state, w, ROUNDS);

    [
        state[0][0], state[1][0], state[2][0], state[3][0],
        state[0][1], state[1][1], state[2][1], state[3][1],
        state[0][2], state[1][2], state[2][2], state[3][2],
        state[0][3], state[1][3], state[2][3], state[3][3],
    ]
    //for (int i = 0; i < 4*Nb; i++) output[i] = state[i%4][i/4];
}

// number of bytes in the key, 256 max for AES = 32 bytes
const KEY_BYTES: usize = 32;
// block size fixed at 16 bytes / 128 bits (Nb=4) for AES
const BLOCK_SIZE: usize = 16;

///
/// Encrypt a text using AES encryption in Counter mode of operation
///
/// Unicode multi-byte character safe
///
/// * `plain_text` Source text to be encrypted
/// * `password`  The password to use to generate a key
/// * `nonce`     Unique number, e.g. time in seconds
/// * `return`    Encrypted text
///
/// The way it works: we split the text into blocks. For each block we prepare
/// a mask: first half the nonce, the second a counter. Then we cipher the mask
/// with the secret key and xor the plaintext block with the ciphered mask.
///
/// See example usage at [`aes_ctr_decrypt`]
///
pub fn aes_ctr_encrypt(plain_text: &str, password: &str, nonce: u64) -> String {

    let plain_bytes = plain_text.as_bytes();
    // let blockSize = 16;  
    //if (!(nBits==128 || nBits==192 || nBits==256)) return "";  // standard allows 128/192/256 bit keys

    // use AES itself to encrypt password to get cipher key (using plain password as source for key
    // expansion) - gives us well encrypted key
    let mut password_bytes:[u8; KEY_BYTES] = [0; KEY_BYTES];
    // copy as much from the password as possible, longer passwords will not be fully used
    let min_size = std::cmp::min(password.len(), KEY_BYTES);
    password_bytes[..min_size].copy_from_slice(&password.as_bytes()[..min_size]);
    
    let key16 = aes_cipher(&password_bytes[..16], &aes_key_expansion(&password_bytes));  // gives us 16-byte key
    let mut key = [0; KEY_BYTES];
    
    // expand key to 16/24/32 bytes long
    key[..16].copy_from_slice(&key16);
    key[16..].copy_from_slice(&key16);

    // initialise counter block (NIST SP800-38A §B.2): millisecond time-stamp for nonce in 1st 8 bytes,
    // block counter in 2nd 8 bytes
    let mut counter_block:[u8; BLOCK_SIZE] = [0; BLOCK_SIZE];
    
    counter_block[..8].copy_from_slice(&nonce.to_le_bytes());

    // and convert it to a string to go on the front of the ciphertext
    // char[] ctrTxt = new char[8];
    // for (int i = 0; i < 8; i++) ctrTxt[i] = counterBlock[i];

    // generate key schedule - an expansion of the key into distinct Key Rounds for each round
    let key_schedule = aes_key_expansion(&key);

    let block_count = (plain_bytes.len() + BLOCK_SIZE - 1) / BLOCK_SIZE;

    // allocate enough space to fill in the last block
    let result_size = 8 + BLOCK_SIZE * block_count;
    let mut cipher_txt = Vec::with_capacity(result_size);

    // nonce goes at the beginning of the encripted string
    cipher_txt.extend_from_slice(&counter_block[..8]);

    // copy the plain text into the destination
    cipher_txt.extend_from_slice(plain_bytes);

    // extend with zeroes
    for _i in 0..result_size - cipher_txt.len() {
        cipher_txt.push(0);
    }

    for b in 0..block_count { 
        // set counter (block #) in last 8 bytes of counter block (leaving nonce in 1st 8 bytes)
        // done in two stages for 32-bit ops: using two words allows us to go past 2^32 blocks (68GB)
        counter_block[8..].copy_from_slice(&(b as u64).to_be_bytes());

        let cipher_counter_block = aes_cipher(&counter_block, &key_schedule);  // -- encrypt counter block --

        let block_start = 8 + b * BLOCK_SIZE;
        cipher_txt[block_start..block_start + BLOCK_SIZE].iter_mut()
            .zip(cipher_counter_block.iter())
            .for_each(|(x, y)| *x ^= *y);
    }

    BASE64_STANDARD.encode(&cipher_txt)  // encode in base64
}

#[cfg(test)]
mod test_encryption {
    #[test]
    fn encrypt() {
        let s = super::aes_ctr_encrypt("aha", "secret", 0 as u64);
        assert_eq!(s, "AAAAAAAAAACTrCPYN+ib5rRz+0RQx0qD");
    }
}

#[allow(dead_code)]
fn print_state(state: &[[u8; 4]; 4]) {
    println!("state [");
    for row in state {
        println!("{:x?}", row);
    }
    println!("]");
}

#[allow(dead_code)]
fn print_w(state: &[[u8; 4]; 60]) {
    println!("w 「");
    for item in state.iter().take(60) {
        println!("{:x?}", item);
    }
    println!("」");
}

///
/// Decrypt a text encrypted by AES in counter mode of operation
///
/// * `ciphertext` Source text to be decrypted
/// * `password`   The password to generate the key from
///
/// ```rust
///  # use memo_rust::aes::aes_ctr_decrypt;
///  # use memo_rust::aes::aes_ctr_encrypt;
///  # use std::time::SystemTime;
///
///    let now = SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).unwrap().as_millis();
///
///    let enc = aes_ctr_encrypt("aha", "secret", now as u64);
///    let dec = aes_ctr_decrypt(&enc, "secret");
///    assert_eq!(dec, "aha");
/// ```
pub fn aes_ctr_decrypt(original_ciphertext: &str, password: &str) -> String {
    let mut ciphertext = BASE64_STANDARD.decode(original_ciphertext).unwrap();

    // use AES to encrypt password (mirroring encrypt routine)
    let mut password_bytes:[u8; KEY_BYTES] = [0; KEY_BYTES];
    // copy as much from the password as possible, longer passwords will not be fully used
    let min_size = std::cmp::min(password.len(), KEY_BYTES);
    password_bytes[..min_size].copy_from_slice(&password.as_bytes()[..min_size]);
    
    let key16 = aes_cipher(&password_bytes[..16], &aes_key_expansion(&password_bytes));  // gives us 16-byte key
    let mut key = [0; KEY_BYTES];
    
    // expand key to 16/24/32 bytes long
    key[..16].copy_from_slice(&key16);
    key[16..].copy_from_slice(&key16);

    // recover nonce from 1st 8 bytes of ciphertext
    let mut counter_block:[u8; BLOCK_SIZE] = [0; BLOCK_SIZE];
    counter_block[..8].copy_from_slice(&ciphertext[..8]);
    // now that we copied the nonce to the counter block remove it from the cipher text
    ciphertext.drain(0..8);

    // generate key schedule
    let key_schedule = aes_key_expansion(&key);

    // separate ciphertext into blocks (skipping past initial 8 bytes)
    let block_count = (ciphertext.len() + BLOCK_SIZE - 1) / BLOCK_SIZE;

    // plaintext will get generated block-by-block into array of block-length strings

    for b in 0..block_count {
        // set counter (block #) in last 8 bytes of counter block (leaving nonce in 1st 8 bytes)
        counter_block[8..].copy_from_slice(&(b as u64).to_be_bytes());
        let cipher_counter_block = aes_cipher(&counter_block, &key_schedule);  // -- encrypt counter block --

        // block size is reduced on final block
        let block_length = if b < block_count - 1 { BLOCK_SIZE } else { (ciphertext.len() - 1) % BLOCK_SIZE + 1 };

        ciphertext[BLOCK_SIZE * b..BLOCK_SIZE * b + block_length].iter_mut()
            .zip(cipher_counter_block.iter())
            .for_each(|(x, y)| *x ^= *y);
    }

    // remove any trailing zeroes
    if let Some(index) = ciphertext.iter().rev().position(|x| *x != 0) {
        ciphertext.truncate(ciphertext.len() - index);
    }

    match String::from_utf8(ciphertext) {
        Ok(s) => s,
        Err(_v) => String::from(original_ciphertext),
    }
}

#[cfg(test)]
mod test_decryption {
    #[test]
    fn decrypt() {
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis();

        let enc = super::aes_ctr_encrypt("aha", "secret", now as u64);
        let dec = super::aes_ctr_decrypt(&enc, "secret");
        assert_eq!(dec, "aha");
    }

    #[test]
    fn longer_string() {
        let text = "A text longer than 16 characters.";
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis();

        let enc = super::aes_ctr_encrypt(text, "secret", now as u64);
        println!("Encrypted string: {}", enc);
        let dec = super::aes_ctr_decrypt(&enc, "secret");
        assert_eq!(dec, text);
    }
}
