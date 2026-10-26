use starknet::secp256_trait::Signature;
use starknet::{ClassHash, EthAddress};

#[starknet::interface]
pub trait IAccount712Admin<TContractState> {
    fn initialize(ref self: TContractState, eth_address: EthAddress, signature: Signature);
    fn get_eth_address(self: @TContractState) -> EthAddress;
    /// Change the signer through an authenticated account self-call.
    fn set_eth_address(ref self: TContractState, new_eth_address: EthAddress);
    fn upgrade(
        ref self: TContractState,
        new_class_hash: ClassHash,
        eic_data: Option<(ClassHash, Span<felt252>)>,
    );
}

#[starknet::interface]
pub trait IEIC<TContractState> {
    fn eic_initialize(ref self: TContractState, data: Span<felt252>);
}

/// Emitted when the contract is upgraded.
#[derive(Drop, Debug, PartialEq, starknet::Event)]
pub struct Upgraded {
    pub class_hash: ClassHash,
}

/// Emitted when the account's controlling Ethereum address changes.
#[derive(Drop, Debug, PartialEq, starknet::Event)]
pub struct EthAddressChanged {
    pub previous_eth_address: EthAddress,
    pub new_eth_address: EthAddress,
}
