use core::keccak::compute_keccak_byte_array;
use eth_712_account::eth_712_utils::{push_outside_execution, recover_eth_address, reverse_u256};
use eth_712_account::interface::{
    IAccount712AdminDispatcher, IAccount712AdminDispatcherTrait, IAccount712AdminSafeDispatcher,
    IAccount712AdminSafeDispatcherTrait,
};
use eth_712_account::test_utils::{
    FIXED_ACCOUNT_ADDRESS, MOCK_ERC20_INITIAL_SUPPLY, TEST_ETH_ADDRESS, TEST_NONCE, TEST_TIMESTAMP,
    build_outside_execution_with_calls, build_transfer_call, deploy_mock_erc20,
    get_outside_execution_signature, get_ownership_signature, get_test_outside_execution,
    setup_efo_test,
};
use openzeppelin::account::extensions::src9::OutsideExecution;
use openzeppelin::account::extensions::src9::interface::{
    ISRC9_V2Dispatcher, ISRC9_V2DispatcherTrait, ISRC9_V2SafeDispatcher,
    ISRC9_V2SafeDispatcherTrait, ISRC9_V2_ID,
};
use openzeppelin::account::interface::{ISRC6Dispatcher, ISRC6DispatcherTrait, ISRC6_ID};
use openzeppelin::introspection::interface::{ISRC5Dispatcher, ISRC5DispatcherTrait};
use openzeppelin::token::erc20::interface::IERC20DispatcherTrait;
use snforge_std::cheatcodes::CheatSpan;
use snforge_std::signature::secp256k1_curve::{
    Secp256k1CurveKeyPair, Secp256k1CurveKeyPairImpl, Secp256k1CurveSignerImpl,
};
use snforge_std::signature::{KeyPairTrait, SignerTrait};
use snforge_std::{
    ContractClassTrait, DeclareResultTrait, EventSpyTrait, cheat_block_timestamp, cheat_chain_id,
    spy_events,
};
use starknet::account::Call;
use starknet::eth_signature::public_key_point_to_eth_address;
use starknet::secp256_trait::Signature;
use starknet::{ClassHash, ContractAddress, EthAddress, SyscallResultTrait};
use testing_utils::event_helpers::get_event_by_selector;

// Public test keys only. OLD_KEY matches TEST_ETH_ADDRESS and the existing test vectors.
const OLD_KEY: u256 = 0xa6d86467b6ec9e161649b27edfd8519e75a2e1cf5f4c309c628706e6999780e8;
const NEW_KEY: u256 = 123456789;
const MIGRATION_NONCE: felt252 = 300;

// EIP-712 domain hash for SN_MAIN, version 2, EVM chain 1, FIXED_ACCOUNT_ADDRESS.
// Computed independently with viem.hashDomain; avoids hardcoding upgrade class hashes/signatures.
const DOMAIN_HASH: u256 = 0xe72a98158562737d6ba98304a1b763c3891bd0257b48fdda7eeea2ee317af636;

fn new_eth_address() -> EthAddress {
    let key_pair: Secp256k1CurveKeyPair = KeyPairTrait::from_secret_key(NEW_KEY);
    public_key_point_to_eth_address(key_pair.public_key)
}

fn sign_hash(hash: u256, key: u256) -> Array<felt252> {
    let key_pair: Secp256k1CurveKeyPair = KeyPairTrait::from_secret_key(key);
    let (r, s) = key_pair.sign(hash).unwrap();
    let address = public_key_point_to_eth_address(key_pair.public_key);
    let v = if recover_eth_address(hash, Signature { r, s, y_parity: false }) == Some(address) {
        27
    } else {
        28
    };
    array![r.high.into(), r.low.into(), s.high.into(), s.low.into(), v, 1]
}

fn sign_execution(execution: @OutsideExecution, key: u256) -> Array<felt252> {
    let mut bytes: ByteArray = "";
    bytes.append_byte(0x19);
    bytes.append_byte(0x01);
    bytes.append_word(DOMAIN_HASH.high.into(), 16);
    bytes.append_word(DOMAIN_HASH.low.into(), 16);
    push_outside_execution(ref bytes, execution);
    sign_hash(reverse_u256(compute_keccak_byte_array(@bytes)), key)
}

fn owner_call(account: ContractAddress, new_owner: EthAddress) -> Call {
    Call {
        to: account,
        selector: selector!("set_eth_address"),
        calldata: array![new_owner.into()].span(),
    }
}

fn migration_calls(
    account: ContractAddress, target: ClassHash, new_owner: EthAddress,
) -> Span<Call> {
    array![
        Call {
            to: account, selector: selector!("upgrade"), calldata: array![target.into(), 1].span(),
        },
        owner_call(account, new_owner),
    ]
        .span()
}

fn setup_legacy() -> (ISRC9_V2Dispatcher, ClassHash, ClassHash) {
    let legacy = snforge_std::declare("LegacyEth712Account").unwrap_syscall();
    let account_address = FIXED_ACCOUNT_ADDRESS.try_into().unwrap();
    legacy.contract_class().deploy_at(@array![], account_address).unwrap_syscall();
    IAccount712AdminDispatcher { contract_address: account_address }
        .initialize(TEST_ETH_ADDRESS(), get_ownership_signature());
    cheat_chain_id(account_address, 'SN_MAIN', CheatSpan::Indefinite);
    cheat_block_timestamp(account_address, TEST_TIMESTAMP, CheatSpan::Indefinite);
    let target = snforge_std::declare("StarknetEth712Account").unwrap_syscall();
    (
        ISRC9_V2Dispatcher { contract_address: account_address },
        *legacy.contract_class().class_hash,
        *target.contract_class().class_hash,
    )
}

#[test]
fn test_get_eth_address() {
    let src9 = setup_efo_test();
    assert!(
        IAccount712AdminDispatcher { contract_address: src9.contract_address }
            .get_eth_address() == TEST_ETH_ADDRESS(),
    );
}

#[test]
#[should_panic(expected: 'UNAUTHORIZED')]
fn test_set_eth_address_rejects_external_caller() {
    let src9 = setup_efo_test();
    IAccount712AdminDispatcher { contract_address: src9.contract_address }
        .set_eth_address(new_eth_address());
}

#[test]
#[should_panic(expected: 'ZERO_ETH_ADDRESS')]
fn test_set_eth_address_rejects_zero() {
    let src9 = setup_efo_test();
    let execution = build_outside_execution_with_calls(
        array![owner_call(src9.contract_address, 0.try_into().unwrap())].span(), MIGRATION_NONCE,
    );
    let signature = sign_execution(@execution, OLD_KEY);
    src9.execute_from_outside_v2(execution, signature.span());
}

#[test]
#[should_panic(expected: 'INVALID_SIGNATURE')]
fn test_set_eth_address_rejects_new_key_before_rotation() {
    let src9 = setup_efo_test();
    let execution = build_outside_execution_with_calls(
        array![owner_call(src9.contract_address, new_eth_address())].span(), MIGRATION_NONCE,
    );
    let signature = sign_execution(@execution, NEW_KEY);
    src9.execute_from_outside_v2(execution, signature.span());
}

#[test]
#[feature("safe_dispatcher")]
fn test_upgrade_and_rotate_with_old_signature() {
    let (src9, legacy, target) = setup_legacy();
    let address = src9.contract_address;
    assert!(legacy != target);
    // The old class genuinely has no setter: it becomes available only after the upgrade.
    let safe_admin = IAccount712AdminSafeDispatcher { contract_address: address };
    assert!(safe_admin.set_eth_address(new_eth_address()).is_err());
    src9
        .execute_from_outside_v2(
            get_test_outside_execution(), get_outside_execution_signature().span(),
        );
    let (token_address, token) = deploy_mock_erc20(address);

    let execution = build_outside_execution_with_calls(
        migration_calls(address, target, new_eth_address()), MIGRATION_NONCE,
    );
    let signature = sign_execution(@execution, OLD_KEY);
    let mut spy = spy_events();
    src9.execute_from_outside_v2(execution, signature.span());

    assert!(starknet::syscalls::get_class_hash_at_syscall(address).unwrap_syscall() == target);
    let admin = IAccount712AdminDispatcher { contract_address: address };
    assert!(admin.get_eth_address() == new_eth_address());
    let events = spy.get_events();
    let (from, event) = get_event_by_selector(events.events.span(), selector!("EthAddressChanged"))
        .unwrap();
    assert!(*from == address);
    assert!(event.data == @array![TEST_ETH_ADDRESS().into(), new_eth_address().into()]);
    assert!(!src9.is_valid_outside_execution_nonce(TEST_NONCE));
    assert!(!src9.is_valid_outside_execution_nonce(MIGRATION_NONCE));
    let src5 = ISRC5Dispatcher { contract_address: address };
    assert!(src5.supports_interface(ISRC6_ID));
    assert!(src5.supports_interface(ISRC9_V2_ID));
    assert!(token.balance_of(address) == MOCK_ERC20_INITIAL_SUPPLY);

    // Both signature validation and actual spending now recognize only the new key.
    let src6 = ISRC6Dispatcher { contract_address: address };
    assert!(src6.is_valid_signature(42, sign_hash(42, OLD_KEY)) == 0);
    assert!(src6.is_valid_signature(42, sign_hash(42, NEW_KEY)) == starknet::VALIDATED);
    let old_execution = build_outside_execution_with_calls(array![].span(), 301);
    let old_signature = sign_execution(@old_execution, OLD_KEY);
    let safe_src9 = ISRC9_V2SafeDispatcher { contract_address: address };
    assert!(
        safe_src9
            .execute_from_outside_v2(
                old_execution, old_signature.span(),
            ) == Result::Err(array!['INVALID_SIGNATURE']),
    );

    let recipient: ContractAddress = 0x5678.try_into().unwrap();
    let new_execution = build_outside_execution_with_calls(
        array![build_transfer_call(token_address, recipient, 100)].span(), 302,
    );
    let new_signature = sign_execution(@new_execution, NEW_KEY);
    src9.execute_from_outside_v2(new_execution, new_signature.span());
    assert!(token.balance_of(recipient) == 100);
    assert!(token.balance_of(address) == MOCK_ERC20_INITIAL_SUPPLY - 100);
}

#[test]
#[should_panic(expected: 'ZERO_ETH_ADDRESS')]
fn test_upgrade_and_rotate_propagates_setter_failure() {
    let (src9, _, target) = setup_legacy();
    let execution = build_outside_execution_with_calls(
        migration_calls(src9.contract_address, target, 0.try_into().unwrap()), MIGRATION_NONCE,
    );
    let signature = sign_execution(@execution, OLD_KEY);
    src9.execute_from_outside_v2(execution, signature.span());
}

#[test]
#[should_panic(expected: 'INVALID_SIGNATURE')]
fn test_upgrade_and_rotate_rejects_tampered_destination() {
    let (src9, _, target) = setup_legacy();
    let intended = build_outside_execution_with_calls(
        migration_calls(src9.contract_address, target, new_eth_address()), MIGRATION_NONCE,
    );
    let signature = sign_execution(@intended, OLD_KEY);
    let tampered = build_outside_execution_with_calls(
        migration_calls(src9.contract_address, target, 0x1234.try_into().unwrap()), MIGRATION_NONCE,
    );
    src9.execute_from_outside_v2(tampered, signature.span());
}

#[test]
#[should_panic(expected: 'DUPLICATE_NONCE')]
fn test_upgrade_and_rotate_rejects_replay() {
    let (src9, _, target) = setup_legacy();
    let calls = migration_calls(src9.contract_address, target, new_eth_address());
    let execution = build_outside_execution_with_calls(calls, MIGRATION_NONCE);
    let signature = sign_execution(@execution, OLD_KEY);
    src9.execute_from_outside_v2(execution, signature.span());
    src9
        .execute_from_outside_v2(
            build_outside_execution_with_calls(calls, MIGRATION_NONCE), signature.span(),
        );
}
